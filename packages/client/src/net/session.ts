const SESSION_TOKEN_KEY = "quixx.sessionToken";
const NICKNAME_KEY = "quixx.nickname";

export function getStoredSessionToken(): string | null {
  return localStorage.getItem(SESSION_TOKEN_KEY);
}

export function setStoredSessionToken(token: string): void {
  localStorage.setItem(SESSION_TOKEN_KEY, token);
}

export function clearStoredSessionToken(): void {
  localStorage.removeItem(SESSION_TOKEN_KEY);
}

export function getStoredNickname(): string {
  return localStorage.getItem(NICKNAME_KEY) ?? "";
}

export function setStoredNickname(nickname: string): void {
  localStorage.setItem(NICKNAME_KEY, nickname);
}
