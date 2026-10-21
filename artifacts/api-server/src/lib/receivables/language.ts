import { BusinessError } from "./model";

export const containsHan = (value: string) => /\p{Script=Han}/u.test(value);
export function assertEnglishInput(value: unknown) {
  if (containsHan(JSON.stringify(value) ?? ""))
    throw new BusinessError("Use English for administrator data. Communication drafts support English and Malay.");
}
