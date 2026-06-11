const fullIDR = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});

const compactIDR = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  notation: "compact",
  compactDisplay: "short",
  maximumFractionDigits: 1,
});

export function formatIDR(value: number, opts?: { compact?: boolean }): string {
  return (opts?.compact ? compactIDR : fullIDR).format(value);
}

const dateFmt = new Intl.DateTimeFormat("id-ID", {
  day: "numeric",
  month: "short",
});

export function formatDate(iso: string): string {
  return dateFmt.format(new Date(iso));
}
