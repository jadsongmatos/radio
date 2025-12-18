// __root.tsx
import {
  HeadContent,
  Scripts,
  createRootRouteWithContext,
} from '@tanstack/react-router'

import 'swiper/css/bundle';
import { QueryClient,QueryClientProvider } from '@tanstack/react-query'
import appCss from '../styles.css?url'
interface MyRouterContext {
  queryClient: QueryClient
}

export const Route = createRootRouteWithContext<MyRouterContext>()({
  head: () => ({
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
      {
        title: 'Web Radio J',
      },
    ],
    links: [
      {
        rel: 'stylesheet',
        href: appCss,
      },
    ],
  }),

  shellComponent: RootDocument,
})

const queryClient = new QueryClient()

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
        <meta name="google-adsense-account" content="ca-pub-7540935582112706"></meta>
        <meta name="google-site-verification" content="K6n_i0D944OJIJwD-M5iQ-jy3oAKFS5aTTL3uJOpy9I" />
        <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-7540935582112706"
          crossOrigin="anonymous"></script>
      </head>
      <body suppressHydrationWarning>
        <QueryClientProvider client={queryClient}>
        {children}
        </QueryClientProvider>
        <Scripts />
      </body>
    </html>
  )
}
