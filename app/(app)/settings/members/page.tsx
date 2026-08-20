import { redirect } from "next/navigation";

// Members lives on the single Settings page now.
export default function MembersRedirect() {
  redirect("/settings");
}
