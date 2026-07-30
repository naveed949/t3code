export function showsWayfinderLaunchChooser(prompt: string): boolean {
  return /^\s*\$wayfinder\s*$/u.test(prompt);
}
