import { z } from "zod/v4";

// Structured output schema for bank statement extraction.
// Matches PRD §4.1 exactly — account metadata + per-transaction detail.
export const transactionSchema = z.object({
  date: z.string().describe("Transaction date in YYYY-MM-DD format"),
  description: z.string().describe("Description exactly as it appears on the statement"),
  amount: z.number().describe("Transaction amount as a positive number"),
  direction: z.enum(["debit", "credit"]).describe("Whether money left or entered the account"),
});

export const extractionSchema = z.object({
  accountHolderName: z.string().nullable(),
  accountNumberMasked: z.string().describe('Account number masked for display, e.g. "****4521"').nullable(),
  bankName: z.string().nullable(),
  statementPeriodStart: z.string().describe("Start date of statement period in YYYY-MM-DD").nullable(),
  statementPeriodEnd: z.string().describe("End date of statement period in YYYY-MM-DD").nullable(),
  openingBalance: z.number().nullable(),
  closingBalance: z.number().nullable(),
  transactions: z.array(transactionSchema),
  isValidBankStatement: z.boolean().describe("False if this PDF does not appear to be a bank statement"),
  notes: z.string().optional().describe("Any caveats, quality issues, or things flagged during extraction"),
});

export type ExtractionResult = z.infer<typeof extractionSchema>;
