export function safeJsonStringify(value: unknown): string {
  return JSON.stringify(
    value,
    (_key, currentValue) => {
      if (currentValue instanceof Error) {
        return {
          name: currentValue.name,
          message: currentValue.message,
          stack: currentValue.stack
        };
      }

      if (typeof currentValue === "bigint") {
        return currentValue.toString();
      }

      return currentValue;
    },
    2
  );
}
