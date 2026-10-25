/**
 * CREAO remains the orchestrator. The backend exposes the investigation call;
 * it does not invoke CREAO or make a finance decision on its behalf.
 */
export function elasticInvestigationHint(exceptionId: string): Record<string, unknown> {
  return {
    elastic_investigation: {
      method: "POST",
      endpoint: `/v1/creao/investigations/${exceptionId}/run`,
      required_permission: "exception:investigate",
      follow_up_supported: true,
      note:
        "Run this after claiming the work item. Findings are evidence-backed and do not approve, dismiss, correct, or pay anything.",
    },
  };
}
