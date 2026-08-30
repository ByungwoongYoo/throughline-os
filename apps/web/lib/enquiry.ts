/**
 * Which line of enquiry this work belongs to.
 *
 * This replaces `lib/session.ts`, which answered the same question by minting a
 * UUID into `sessionStorage`. That made a browser tab decide what
 * multiple-comparison correction ran over, and it was wrong in three ways at
 * once: the researcher could not see the family, so they could not tell us it
 * was wrong; two windows split one afternoon into two families, each reporting
 * its looks with more confidence than they had earned; and closing the tab
 * discarded the identifier while the looks themselves stayed in the database,
 * so the record became unreachable rather than ending.
 *
 * The client no longer decides. It asks the server which line of enquiry is
 * open for this project, and the server is the single place that defines what
 * "the same sitting" means. Requests that record a look now send no family at
 * all — omitting it means "the open one", which is what an interactive caller
 * always wanted and previously had to compute for itself.
 *
 * Nothing here is cached in the browser. The whole failure being repaired was a
 * browser holding an identifier the server could not verify.
 */

import { api } from "./api";

export type Enquiry = {
  id: string;
  project_id: string;
  name: string;
  opened_at: string;
  closed_at: string | null;
  closed_why: "researcher" | "idle" | null;
  looks: number;
};

/** The family a look recorded right now would join. Opens one if none is. */
export function currentEnquiry(projectId: string): Promise<Enquiry> {
  return api.get<Enquiry>(`/api/projects/${projectId}/enquiries/current`);
}

/** Every line of enquiry on this project, most recent first. */
export function listEnquiries(projectId: string): Promise<Enquiry[]> {
  return api.get<Enquiry[]>(`/api/projects/${projectId}/enquiries`);
}

/** Start a fresh family. Closes whichever one is open. */
export function openEnquiry(projectId: string, name?: string): Promise<Enquiry> {
  return api.post<Enquiry>(`/api/projects/${projectId}/enquiries`,
    { name: name ?? null });
}

/** Close the open family without starting another. */
export function closeEnquiry(projectId: string): Promise<{ closed: Enquiry | null }> {
  return api.post<{ closed: Enquiry | null }>(
    `/api/projects/${projectId}/enquiries/close`);
}

/** Name the question. Allowed on a closed enquiry — naming is not membership. */
export function renameEnquiry(
  projectId: string, enquiryId: string, name: string,
): Promise<Enquiry> {
  return api.patch<Enquiry>(
    `/api/projects/${projectId}/enquiries/${enquiryId}`, { name });
}

/**
 * How an enquiry ended, in words a researcher can act on.
 *
 * `idle` is an inference we made on their behalf rather than a decision they
 * took, and it says so — §123: absence is never silent, and neither is a guess.
 */
export function endedBecause(enquiry: Enquiry): string | null {
  if (!enquiry.closed_at) return null;
  return enquiry.closed_why === "idle"
    ? "Closed automatically after three quiet days"
    : "Closed deliberately";
}
