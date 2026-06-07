import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MessageCircle, Search } from "lucide-react";

import { Layout } from "@/components/Layout";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import {
  buildThreads,
  fetchConversations,
  fetchConversationStates,
  formatDateTime,
} from "@/lib/conversations";

export const Route = createFileRoute("/conversations")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Conversations · Ankit Motors" },
      {
        name: "description",
        content: "WhatsApp customer conversations and qualification status.",
      },
    ],
  }),
  component: ConversationsPage,
});

function ConversationsPage() {
  const { data: conversations = [], isLoading: l1 } = useQuery({
    queryKey: ["conversations"],
    queryFn: fetchConversations,
  });
  const { data: states = [], isLoading: l2 } = useQuery({
    queryKey: ["conversation_states"],
    queryFn: fetchConversationStates,
  });

  const [q, setQ] = useState("");

  const threads = useMemo(
    () => buildThreads(conversations, states),
    [conversations, states],
  );

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return threads;
    return threads.filter(
      (t) =>
        t.phone_number.toLowerCase().includes(term) ||
        t.last_message.toLowerCase().includes(term),
    );
  }, [threads, q]);

  const isLoading = l1 || l2;

  return (
    <Layout>
      <div className="mb-6 flex items-center gap-2">
        <MessageCircle className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-semibold">WhatsApp Conversations</h1>
      </div>

      <div className="relative mb-4 max-w-sm">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by phone or message"
          className="pl-9"
        />
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Phone Number</TableHead>
              <TableHead>Last Message</TableHead>
              <TableHead>Bihar Verified</TableHead>
              <TableHead>Interested</TableHead>
              <TableHead>Messages</TableHead>
              <TableHead>Last Activity</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground">
                  Loading…
                </TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground">
                  No conversations yet.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((t) => (
                <TableRow key={t.phone_number}>
                  <TableCell className="font-medium">{t.phone_number}</TableCell>
                  <TableCell className="max-w-xs truncate text-muted-foreground">
                    {t.last_message}
                  </TableCell>
                  <TableCell>
                    <Badge variant={t.state_verified ? "default" : "secondary"}>
                      {t.state_verified ? "Verified" : "Pending"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={t.interested ? "default" : "outline"}>
                      {t.interested ? "Yes" : "No"}
                    </Badge>
                  </TableCell>
                  <TableCell>{t.count}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDateTime(t.last_at)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </Layout>
  );
}
