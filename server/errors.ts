/** An error whose message is safe to show and whose status is a client error. */
export function httpError(status: number, message: string) {
  return Object.assign(new Error(message), { status });
}
