export function groupCaption(name: string, courseName: string): string {
  return !courseName ||
    name.trim().toLocaleLowerCase('ru') === courseName.trim().toLocaleLowerCase('ru')
    ? name
    : `${name} • ${courseName}`;
}
