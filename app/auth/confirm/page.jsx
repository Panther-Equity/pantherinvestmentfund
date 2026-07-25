import ConfirmInviteClient from "./ConfirmInviteClient";

export default function ConfirmPage({ searchParams }) {
  const token_hash = searchParams?.token_hash || "";
  const type = searchParams?.type || "";
  const next = searchParams?.next || "/";

  return <ConfirmInviteClient token_hash={token_hash} type={type} next={next} />;
}
