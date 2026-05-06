import { Heading, Text } from "@react-email/components"
import { EmailLayout } from "./_layout"

export interface WelcomeEmailProps {
  userName?: string | null
}

export function WelcomeEmail({ userName }: WelcomeEmailProps) {
  return (
    <EmailLayout preview="Welcome to Pathway">
      <Heading className="text-xl">Welcome{userName ? `, ${userName}` : ""}</Heading>
      <Text>
        Your account is ready. Sign in any time to manage your work, your team, and your processes.
      </Text>
    </EmailLayout>
  )
}

export default WelcomeEmail
