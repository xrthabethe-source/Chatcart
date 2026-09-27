// Written without constructor parameter properties on purpose: Node's
// --experimental-strip-types (used to run tests without a build step)
// only strips erasable syntax.
export class ServiceError extends Error {
  readonly code: string;
  readonly httpStatus: number;

  constructor(message: string, code: string, httpStatus: number) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export class ValidationError extends ServiceError {
  constructor(message: string) {
    super(message, "VALIDATION_ERROR", 400);
  }
}

export class NotFoundError extends ServiceError {
  constructor(entity: string) {
    super(`${entity} not found.`, "NOT_FOUND", 404);
  }
}

export class ConflictError extends ServiceError {
  constructor(message: string) {
    super(message, "CONFLICT", 409);
  }
}

export class UnauthenticatedError extends ServiceError {
  constructor(message = "Authentication required.") {
    super(message, "UNAUTHENTICATED", 401);
  }
}

export class ForbiddenError extends ServiceError {
  constructor(message = "Not allowed.") {
    super(message, "FORBIDDEN", 403);
  }
}

/** A courier/provider could not do what was asked right now. */
export class DeliveryUnavailableError extends ServiceError {
  constructor(message: string) {
    super(message, "DELIVERY_UNAVAILABLE", 422);
  }
}

export function zodMessage(error: { issues: { path: (string | number)[]; message: string }[] }): string {
  return error.issues.map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message)).join("; ");
}
