import { ZodError } from "zod";

export interface ErrorBody {
  code: string;
  detail: string;
  retryable: boolean;
  violations: string[];
}

export class ApiError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly detail: string;
  readonly retryable: boolean;
  readonly violations: string[];

  constructor(
    statusCode: number,
    code: string,
    detail: string,
    options: { retryable?: boolean; violations?: string[] } = {},
  ) {
    super(detail);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.code = code;
    this.detail = detail;
    this.retryable = options.retryable ?? (statusCode === 429 || statusCode >= 500);
    this.violations = options.violations ?? [];
  }

  toBody(): ErrorBody {
    return {
      code: this.code,
      detail: this.detail,
      retryable: this.retryable,
      violations: this.violations,
    };
  }
}

export function validationError(error: ZodError): ApiError {
  return new ApiError(422, "validation_failed", "The request body or query is invalid.", {
    retryable: false,
    violations: error.issues.map((issue) => `${issue.path.join(".") || "_"}: ${issue.message}`),
  });
}

export function isDatabaseUnavailable(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error && typeof error.code === "string" ? error.code : "";
  if (["ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "08000", "08001", "08006", "57P01", "57P03"].includes(code)) {
    return true;
  }
  const message = error instanceof Error ? error.message : "";
  return /connect ECONNREFUSED|database system is starting up|connection terminated|password authentication failed/i.test(
    message,
  );
}
