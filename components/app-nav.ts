import {
  Archive,
  Bot,
  Files,
  LayoutDashboard,
  Send,
  Settings,
  Users,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  subtitle: string;
  icon: typeof Send;
};

export const NAV_GROUPS: Array<{ label: string; items: NavItem[] }> = [
  {
    label: "Workspace",
    items: [
      {
        href: "/dashboard",
        label: "Dashboard",
        subtitle: "Your documents at a glance.",
        icon: LayoutDashboard,
      },
      {
        href: "/send",
        label: "Send",
        subtitle: "Send a PDF for signature.",
        icon: Send,
      },
      {
        href: "/documents",
        label: "Documents",
        subtitle: "Documents you have sent and where they stand.",
        icon: Archive,
      },
      {
        href: "/templates",
        label: "Templates",
        subtitle: "Reusable setups for documents you send often.",
        icon: Files,
      },
    ],
  },
  {
    label: "Organization",
    items: [
      {
        href: "/team",
        label: "Team",
        subtitle: "People who share your documents.",
        icon: Users,
      },
      {
        href: "/agents",
        label: "Agents",
        subtitle: "API keys, OAuth clients, and webhooks.",
        icon: Bot,
      },
      {
        href: "/settings",
        label: "Settings",
        subtitle: "Email, passkeys, branding, and plan.",
        icon: Settings,
      },
    ],
  },
];

export const NAV = NAV_GROUPS.flatMap((group) => group.items);
