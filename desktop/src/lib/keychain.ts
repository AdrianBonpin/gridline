import { saveConnectionPassword, deleteConnectionPassword } from "./commands";

// Persist (or purge) the DB password according to the keychain toggle.
// use_keychain defaults to true (opt-out): ON = OS keychain; OFF = purge + session-only.
// Shared by connectionStore.createConnection and EditConnectionModal.
export async function persistDbPassword(
  connectionId: string,
  useKeychain: boolean | undefined,
  password: string | null | undefined,
): Promise<void> {
  const useKc = useKeychain ?? true;
  if (useKc && password) {
    await saveConnectionPassword(connectionId, password);
  } else if (!useKc) {
    try { await deleteConnectionPassword(connectionId); } catch { /* purge; ignore missing */ }
  }
}