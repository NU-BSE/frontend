let customUserId: string | undefined;

export const setCustomUserId = (userId: string): void => {
  customUserId = userId;
};

export const getCustomUserId = (): string | undefined => customUserId;

export const userHeaders = (): Record<string, string> =>
  customUserId ? { 'x-user-id': customUserId } : {};
