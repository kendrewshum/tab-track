import Image from "next/image";

type TabTrackLogoProps = {
  className?: string;
  decorative?: boolean;
};

export function TabTrackLogo({
  className = "h-7 w-7",
  decorative = false,
}: TabTrackLogoProps) {
  return (
    <Image
      src="/tabtrack-mark.svg"
      alt={decorative ? "" : "TabTrack logo"}
      aria-hidden={decorative ? true : undefined}
      data-testid="tabtrack-logo"
      className={className}
      width={28}
      height={28}
      priority
    />
  );
}
