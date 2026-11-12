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

    const problem = this.toProblem(exception, request);

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
  ): ProblemDetails {
    // Fastify assigns the request ID (see createFastifyAdapter), so it is
    // available even when logging middleware did not run for this route.
    const requestId = request.id;
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
        const { message, errorCode, errors, issues } = body as {
          message?: unknown;
          errorCode?: unknown;
          errors?: unknown;
          issues?: unknown;
        };
        if (typeof message === 'string') {
          problem.detail = message;
        }
        // Validation pipes report per-field problems as an array, under
        // `errors`, `issues`, or as an array `message`.
        const list = [errors, issues, message].find(
          (value): value is unknown[] => Array.isArray(value),
        );
        if (list) {
          problem.detail ??= 'Request validation failed.';
          problem.errors = list;
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
