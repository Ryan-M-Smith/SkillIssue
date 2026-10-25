const codePattern = /^[A-Z0-9]{6}$/;

/** The six-character code shown on the game screen, cleaned up; throws if it isn't one. */
export function normalizeLobbyCode(input: string): string {
	const code = input.replace(/[\s-]/g, "").toUpperCase();
	if (!codePattern.test(code)) throw new Error("Enter the 6-character code shown on the game screen.");
	return code;
}
