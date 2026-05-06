import { Button, Heading, Text } from "@react-email/components"
import { EmailLayout } from "./_layout"

export interface ResetPasswordEmailProps {
  url: string
  userName?: string | null
}

export function ResetPasswordEmail({ url, userName }: ResetPasswordEmailProps) {
  return (
    <EmailLayout preview="Reset your Pathway password">
      <Heading className="text-xl">Reset your password{userName ? `, ${userName}` : ""}</Heading>
      <Text>Click the button below to set a new password. This link expires in 1 hour.</Text>
      <Button
        href={url}
        className="mt-2 rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white"
      >
        Reset password
      </Button>
      <Text className="mt-6 text-xs text-neutral-500">Or paste this link into your browser:</Text>
      <Text className="text-xs break-all text-neutral-700">{url}</Text>
    </EmailLayout>
  )
}

export default ResetPasswordEmail
