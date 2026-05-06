import { Button, Heading, Text } from "@react-email/components"
import { EmailLayout } from "./_layout"

export interface VerifyEmailProps {
  url: string
  userName?: string | null
}

export function VerifyEmail({ url, userName }: VerifyEmailProps) {
  return (
    <EmailLayout preview="Verify your email to start using Pathway">
      <Heading className="text-xl">Verify your email{userName ? `, ${userName}` : ""}</Heading>
      <Text>
        Click the button below to verify your email address. This link expires in 24 hours.
      </Text>
      <Button
        href={url}
        className="mt-2 rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white"
      >
        Verify email
      </Button>
      <Text className="mt-6 text-xs text-neutral-500">Or paste this link into your browser:</Text>
      <Text className="text-xs break-all text-neutral-700">{url}</Text>
    </EmailLayout>
  )
}

export default VerifyEmail
