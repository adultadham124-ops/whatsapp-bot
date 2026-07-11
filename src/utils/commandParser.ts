export interface ParsedCommand {
  type: 'list_tasks' | 'mark_done' | 'daily_summary';
  taskNumber?: number;
}

export function parseCommand(text: string): ParsedCommand | null {
  const trimmed = text.trim();

  // "مهامي" أو "عرض مهامي" أو "أظهر مهامي"
  if (/^(مهامي|عرض مهامي|أظهر مهامي|وريني مهامي)$/.test(trimmed)) {
    return { type: 'list_tasks' };
  }

  // "ملخصي" أو "ملخص يومي" أو "عاوز ملخص يومي"
  if (/^(ملخصي|ملخص يومي|عاوز ملخص يومي|الملخص اليومي)$/.test(trimmed)) {
    return { type: 'daily_summary' };
  }

  // "تم [رقم]" — رقم المهمة
  const markMatch = trimmed.match(/^تم\s*(\d+)$/);
  if (markMatch) {
    return { type: 'mark_done', taskNumber: parseInt(markMatch[1], 10) };
  }

  return null;
}
