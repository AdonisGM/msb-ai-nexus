/** Reading a constraint name back off a driver error.
 *
 *  Drizzle wraps the error the driver raised, so the name sits either on the
 *  error itself or on its cause depending on which layer produced it. Reading
 *  both keeps callers asking about the rule rather than about the plumbing.
 *
 *  Worth catching at all because some races are cheaper to lose than to
 *  prevent: two people creating a customer in the same instant land on the
 *  same code, and walking to the next number beats making the second person
 *  retype the form. */
export function constraintOf(error: unknown): string | undefined {
  const seen = error as { constraint_name?: string; cause?: { constraint_name?: string } }
  return seen?.constraint_name ?? seen?.cause?.constraint_name
}

export function isUniqueViolation(error: unknown, constraint: string): boolean {
  return constraintOf(error) === constraint
}
