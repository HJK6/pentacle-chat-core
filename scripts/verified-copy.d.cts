interface VerifiedPin {
  schema: 3;
  representation: 'verified_copy';
  path: 'pentacle-chat-core';
  commit: string;
  files: { path: string; mode: '100644' | '100755'; sha256: string }[];
}
declare const verifier: {
  check(root: string): VerifiedPin;
  checkAgainstGit(root: string, upstream: string): VerifiedPin;
  syncFromGit(root: string, upstream: string, commit: string): VerifiedPin;
};
export = verifier;
