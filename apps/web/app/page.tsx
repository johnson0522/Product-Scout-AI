import { Button, Card, CardContent, CardHeader } from '@product-scout/ui';

export default function HomePage() {
  return (
    <main className="min-h-screen flex items-center justify-center">
      <Card className="w-full max-w-md">
        <CardHeader>
          <h1 className="text-2xl font-bold text-gray-900">Product Scout</h1>
        </CardHeader>
        <CardContent>
          <p className="text-gray-600 mb-6">
            AI-powered product research and opportunity analysis platform.
          </p>
          <div className="space-y-3">
            <Button className="w-full">Get Started</Button>
            <Button variant="secondary" className="w-full">
              View Documentation
            </Button>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
