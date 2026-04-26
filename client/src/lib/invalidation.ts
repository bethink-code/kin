import { QueryClient } from "@tanstack/react-query";

export function invalidateAuth(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: ["/api/auth/user"] });
}

export function invalidateAdmin(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: ["/api/admin/users"] });
  qc.invalidateQueries({ queryKey: ["/api/admin/invites"] });
  qc.invalidateQueries({ queryKey: ["/api/admin/access-requests"] });
  qc.invalidateQueries({ queryKey: ["/api/admin/audit-logs"] });
  qc.invalidateQueries({ queryKey: ["/api/admin/security-overview"] });
}

export function invalidateStatements(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: ["/api/statements"] });
}

export function invalidatePrompts(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: ["/api/admin/prompts"] });
}

export function invalidateConversation(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: ["/api/qa/conversation"] });
}

export function invalidateAnalysisConversation(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: ["/api/analysis-conversation"] });
}

export function invalidateAnalysisDraft(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: ["/api/analysis-draft/current"] });
}
