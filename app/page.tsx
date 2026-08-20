import { redirect } from "next/navigation";

// Middleware sends logged-out visitors to /login before this runs,
// so anyone reaching the root is logged in. The map is the landing page.
export default function Home() {
  redirect("/map");
}
