/** The custom type belongs to an expense, never to the category register. */
export const CUSTOM_EXPENSE_MAX_LENGTH = 160;

export function isOtherExpenseCategory(name: string | null | undefined): boolean {
  return name?.trim().toLowerCase() === 'other';
}

export function expenseCategoryLabel(category: string, customExpense?: string | null): string {
  const custom = customExpense?.trim();
  return custom ? `${category} — ${custom}` : category;
}
