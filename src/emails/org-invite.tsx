import { Button, Heading, Text } from "@react-email/components"
import { EmailLayout } from "./_layout"

export interface OrgInviteEmailProps {
  url: string
  organizationName: string
  inviterName?: string | null
}

export function OrgInviteEmail({ url, organizationName, inviterName }: OrgInviteEmailProps) {
  return (
    <EmailLayout preview={`You've been invited to ${organizationName}`}>
      <Heading className="text-xl">Join {organizationName} on Pathway</Heading>
      <Text>
        {inviterName ? `${inviterName} has invited you` : "You have been invited"} to join{" "}
        <strong>{organizationName}</strong> on Pathway.
      </Text>
      <Button
        href={url}
        className="mt-2 rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white"
      >
        Accept invitation
      </Button>
      <Text className="mt-6 text-xs text-neutral-500">Or paste this link into your browser:</Text>
      <Text className="text-xs break-all text-neutral-700">{url}</Text>
    </EmailLayout>
  )
}

export default OrgInviteEmail
