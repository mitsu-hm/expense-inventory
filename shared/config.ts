export const BRAND = { name: 'LedgerSprout', tagline: 'Your stock and expenses, together.' } as const;
export const DEFAULTS = { currency: 'INR', timezone: 'Asia/Kolkata', weekStartsOn: 1, reminderMinutes: 120, reportingDate: 'paymentDate' } as const;
export const REMINDER_MESSAGE = 'There were no entries found for the last 2 hours so kindly upload the screenshot or manually update the paid bills';
export function formatReminderMessage(intervalMinutes: number): string {
  if (intervalMinutes === DEFAULTS.reminderMinutes) return REMINDER_MESSAGE;
  const hours = intervalMinutes % 60 === 0;
  const amount = hours ? intervalMinutes / 60 : intervalMinutes;
  const unit = hours ? 'hour' : 'minute';
  return `There were no entries found for the last ${amount} ${unit}${amount === 1 ? '' : 's'} so kindly upload the screenshot or manually update the paid bills`;
}
export const PAYMENT_METHODS = ['Cash', 'UPI', 'Card'] as const;
