import type { ReactNode } from "react"
import {
  Body,
  Container,
  Head,
  Html,
  Preview,
  Section,
  Tailwind,
  Text,
} from "@react-email/components"

export function EmailLayout({ preview, children }: { preview: string; children: ReactNode }) {
  return (
    <Html>
      <Head />
      <Preview>{preview}</Preview>
      <Tailwind>
        <Body className="bg-white font-sans">
          <Container className="mx-auto max-w-xl px-6 py-10">
            <Section className="border-b border-neutral-200 pb-6">
              <Text className="m-0 text-2xl font-semibold text-neutral-900">Pathway</Text>
            </Section>
            <Section className="pt-6">{children}</Section>
            <Section className="mt-10 border-t border-neutral-200 pt-6">
              <Text className="m-0 text-xs text-neutral-500">
                If you didn&apos;t expect this email you can safely ignore it.
              </Text>
            </Section>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  )
}
