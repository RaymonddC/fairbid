/** AG Grid has no option for the table's accessible name, so it is set on the grid element once it exists. */
export function nameGrid(container: HTMLElement | null, label: string) {
  container?.querySelector('[role="grid"], [role="treegrid"]')?.setAttribute("aria-label", label);
}
