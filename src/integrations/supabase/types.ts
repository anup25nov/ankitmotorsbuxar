export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      bike_media: {
        Row: {
          bike_id: string
          created_at: string
          file_url: string
          id: string
          media_type: Database["public"]["Enums"]["media_type"]
        }
        Insert: {
          bike_id: string
          created_at?: string
          file_url: string
          id?: string
          media_type: Database["public"]["Enums"]["media_type"]
        }
        Update: {
          bike_id?: string
          created_at?: string
          file_url?: string
          id?: string
          media_type?: Database["public"]["Enums"]["media_type"]
        }
        Relationships: [
          {
            foreignKeyName: "bike_media_bike_id_fkey"
            columns: ["bike_id"]
            isOneToOne: false
            referencedRelation: "bikes"
            referencedColumns: ["id"]
          },
        ]
      }
      bikes: {
        Row: {
          company: string
          condition_notes: string | null
          created_at: string
          display_price: number
          id: string
          km_covered: number
          model: string
          negotiation_percentage: number
          rto_number: string
          status: Database["public"]["Enums"]["bike_status"]
          updated_at: string
          year: number
        }
        Insert: {
          company: string
          condition_notes?: string | null
          created_at?: string
          display_price: number
          id?: string
          km_covered?: number
          model: string
          negotiation_percentage?: number
          rto_number: string
          status?: Database["public"]["Enums"]["bike_status"]
          updated_at?: string
          year: number
        }
        Update: {
          company?: string
          condition_notes?: string | null
          created_at?: string
          display_price?: number
          id?: string
          km_covered?: number
          model?: string
          negotiation_percentage?: number
          rto_number?: string
          status?: Database["public"]["Enums"]["bike_status"]
          updated_at?: string
          year?: number
        }
        Relationships: []
      }
      conversation_state: {
        Row: {
          budget: number | null
          created_at: string
          current_bike_id: string | null
          id: string
          interested: boolean
          last_summary: string | null
          negotiation_progress: string | null
          phone_number: string
          preferred_brands: string | null
          state_verified: boolean
          updated_at: string
          usage_type: string | null
        }
        Insert: {
          budget?: number | null
          created_at?: string
          current_bike_id?: string | null
          id?: string
          interested?: boolean
          last_summary?: string | null
          negotiation_progress?: string | null
          phone_number: string
          preferred_brands?: string | null
          state_verified?: boolean
          updated_at?: string
          usage_type?: string | null
        }
        Update: {
          budget?: number | null
          created_at?: string
          current_bike_id?: string | null
          id?: string
          interested?: boolean
          last_summary?: string | null
          negotiation_progress?: string | null
          phone_number?: string
          preferred_brands?: string | null
          state_verified?: boolean
          updated_at?: string
          usage_type?: string | null
        }
        Relationships: []
      }
      conversations: {
        Row: {
          created_at: string
          id: string
          message: string
          phone_number: string
          sender: Database["public"]["Enums"]["conversation_sender"]
        }
        Insert: {
          created_at?: string
          id?: string
          message: string
          phone_number: string
          sender: Database["public"]["Enums"]["conversation_sender"]
        }
        Update: {
          created_at?: string
          id?: string
          message?: string
          phone_number?: string
          sender?: Database["public"]["Enums"]["conversation_sender"]
        }
        Relationships: []
      }
      lead_events: {
        Row: {
          created_at: string
          description: string
          event_type: string
          id: string
          lead_id: string
        }
        Insert: {
          created_at?: string
          description: string
          event_type: string
          id?: string
          lead_id: string
        }
        Update: {
          created_at?: string
          description?: string
          event_type?: string
          id?: string
          lead_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_events_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          bike_id: string | null
          bike_name: string | null
          conversation_summary: string | null
          created_at: string
          id: string
          last_offered_price: number | null
          phone_number: string
          status: Database["public"]["Enums"]["lead_status"]
          updated_at: string
        }
        Insert: {
          bike_id?: string | null
          bike_name?: string | null
          conversation_summary?: string | null
          created_at?: string
          id?: string
          last_offered_price?: number | null
          phone_number: string
          status?: Database["public"]["Enums"]["lead_status"]
          updated_at?: string
        }
        Update: {
          bike_id?: string | null
          bike_name?: string | null
          conversation_summary?: string | null
          created_at?: string
          id?: string
          last_offered_price?: number | null
          phone_number?: string
          status?: Database["public"]["Enums"]["lead_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "leads_bike_id_fkey"
            columns: ["bike_id"]
            isOneToOne: false
            referencedRelation: "bikes"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_admin: { Args: never; Returns: boolean }
    }
    Enums: {
      app_role: "admin" | "user"
      bike_status: "Available" | "Reserved" | "Sold"
      conversation_sender: "customer" | "bot"
      lead_status: "New" | "Store Visit Scheduled" | "Visited" | "Sold" | "Lost"
      media_type: "photo" | "video"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "user"],
      bike_status: ["Available", "Reserved", "Sold"],
      conversation_sender: ["customer", "bot"],
      lead_status: ["New", "Store Visit Scheduled", "Visited", "Sold", "Lost"],
      media_type: ["photo", "video"],
    },
  },
} as const
