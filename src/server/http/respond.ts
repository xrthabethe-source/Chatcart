import { NextResponse } from "next/server";
import { ServiceError } from "../services/errors.ts";

export function jsonError(error: unknown): NextResponse {
  if (error instanceof ServiceError) {
    return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.httpStatus });
  }
  if (error instanceof SyntaxError) {
    return NextResponse.json({ error: { code: "BAD_JSON", message: "Request body must be valid JSON." } }, { status: 400 });
  }
  console.error("Unhandled API error:", error);
  return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: "Something went wrong." } }, { status: 500 });
}

/** Wraps a route handler so every thrown error becomes a JSON response. */
export function handle<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (error) {
      return jsonError(error);
    }
  };
}
