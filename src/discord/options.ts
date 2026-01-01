export function getOptionValue(interaction: any, name: string): any | undefined {
  const opts = interaction?.data?.options;
  if (!Array.isArray(opts)) return undefined;
  const found = opts.find((o: any) => o?.name === name);
  return found?.value;
}

