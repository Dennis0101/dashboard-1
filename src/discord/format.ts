export function formatKrw(n: bigint): string {
  const s = n.toString();
  const parts: string[] = [];
  for (let i = s.length; i > 0; i -= 3) {
    parts.unshift(s.slice(Math.max(0, i - 3), i));
  }
  return `${parts.join(",")}원`;
}

