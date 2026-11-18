import { getInitials } from "@/lib/avatar";

type MemberAvatarProps = {
  name: string;
  className?: string;
};

export function MemberAvatar({ name, className = "h-8 w-8 text-xs" }: MemberAvatarProps) {
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center rounded-full bg-brand-100 font-semibold text-brand-700 ${className}`}
    >
      {getInitials(name)}
    </span>
  );
}
