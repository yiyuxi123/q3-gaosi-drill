export function getAvatarInitial(realName: string, username = ''): string {
  const firstHanCharacter = realName.match(/[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/u)?.[0];
  if (firstHanCharacter) return firstHanCharacter;
  const accountInitial = username.trim().charAt(0);
  return accountInitial ? accountInitial.toUpperCase() : '人';
}
