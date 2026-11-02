import { STATUS_CODES } from 'node:http';
import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { PinoLogger } from 'nestjs-pino';
import { REQUEST_ID_HEADER } from '../logging/request-id.js';

/** RFC 9457 Problem Details, plus a request ID and optional extensions. */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  requestId?: string;
  errorCode?: string;
  errors?: unknown[];
}

const PROBLEM_CONTENT_TYPE = 'application/problem+json; charset=utf-8';

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  constructor(
    private readonly httpAdapterHost: HttpAdapterHost,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(ProblemDetailsFilter.name);
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<FastifyRequest>();
    const reply = ctx.getResponse<FastifyReply>();

    const problem = this.toProblem(exception, request, reply);

    if (problem.status >= 500) {
      this.logger.error({ err: exception }, 'Unhandled exception');
    }

    const { httpAdapter } = this.httpAdapterHost;
    httpAdapter.setHeader(reply, 'content-type', PROBLEM_CONTENT_TYPE);
    httpAdapter.reply(reply, problem, problem.status);
  }

  private toProblem(
    exception: unknown,
    request: FastifyRequest,
    reply: FastifyReply,
  ): ProblemDetails {
    const header = reply.raw.getHeader(REQUEST_ID_HEADER);
    const requestId = typeof header === 'string' ? header : String(request.id);
    const instance = request.url;

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const problem: ProblemDetails = {
        type: 'about:blank',
        title: STATUS_CODES[status] ?? 'Error',
        status,
        instance,
        requestId,
      };

      const body = exception.getResponse();
      if (typeof body === 'string') {
        problem.detail = body;
      } else if (typeof body === 'object') {
        const { message, errorCode } = body as {
          message?: unknown;
          errorCode?: unknown;
        };
        if (typeof message === 'string') {
          problem.detail = message;
        } else if (Array.isArray(message)) {
          problem.detail = 'Request validation failed.';
          problem.errors = message;
        }
        if (typeof errorCode === 'string') {
          problem.errorCode = errorCode;
        }
      }
      return problem;
    }

    // Never leak internals for unexpected errors.
    return {
      type: 'about:blank',
      title: STATUS_CODES[500] ?? 'Internal Server Error',
      status: 500,
      detail: 'An unexpected error occurred.',
      instance,
      requestId,
    };
  }
}
