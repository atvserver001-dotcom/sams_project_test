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
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      classes: {
        Row: {
          class_name: string | null
          class_number: number
          created_at: string
          grade_id: string
          id: string
        }
        Insert: {
          class_name?: string | null
          class_number: number
          created_at?: string
          grade_id: string
          id?: string
        }
        Update: {
          class_name?: string | null
          class_number?: number
          created_at?: string
          grade_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "classes_grade_id_fkey"
            columns: ["grade_id"]
            isOneToOne: false
            referencedRelation: "grades"
            referencedColumns: ["id"]
          },
        ]
      }
      content_devices: {
        Row: {
          content_id: string
          device_id: string
        }
        Insert: {
          content_id: string
          device_id: string
        }
        Update: {
          content_id?: string
          device_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_devices_content_id_fkey"
            columns: ["content_id"]
            isOneToOne: false
            referencedRelation: "contents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_devices_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
        ]
      }
      contents: {
        Row: {
          color_hex: string
          color_key: string
          created_at: string | null
          description: string | null
          id: string
          name: string
          updated_at: string | null
        }
        Insert: {
          color_hex?: string
          color_key?: string
          created_at?: string | null
          description?: string | null
          id?: string
          name: string
          updated_at?: string | null
        }
        Update: {
          color_hex?: string
          color_key?: string
          created_at?: string | null
          description?: string | null
          id?: string
          name?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      device_management: {
        Row: {
          created_at: string
          device_id: string | null
          end_date: string | null
          id: string
          limited_period: boolean
          school_id: string | null
          start_date: string | null
        }
        Insert: {
          created_at?: string
          device_id?: string | null
          end_date?: string | null
          id?: string
          limited_period?: boolean
          school_id?: string | null
          start_date?: string | null
        }
        Update: {
          created_at?: string
          device_id?: string | null
          end_date?: string | null
          id?: string
          limited_period?: boolean
          school_id?: string | null
          start_date?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "device_management_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "device_management_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      devices: {
        Row: {
          device_name: string
          icon_path: string | null
          id: string
          linkable: boolean
          page: boolean
          sort_order: number | null
        }
        Insert: {
          device_name: string
          icon_path?: string | null
          id?: string
          linkable?: boolean
          page?: boolean
          sort_order?: number | null
        }
        Update: {
          device_name?: string
          icon_path?: string | null
          id?: string
          linkable?: boolean
          page?: boolean
          sort_order?: number | null
        }
        Relationships: []
      }
      exercise_ingest_events: {
        Row: {
          class_no: number
          created_at: string
          exercise_type: string
          grade: number
          id: string
          idempotency_key: string
          month: number
          recognition_key: string
          student_no: number
          year: number
        }
        Insert: {
          class_no: number
          created_at?: string
          exercise_type: string
          grade: number
          id?: string
          idempotency_key: string
          month: number
          recognition_key: string
          student_no: number
          year: number
        }
        Update: {
          class_no?: number
          created_at?: string
          exercise_type?: string
          grade?: number
          id?: string
          idempotency_key?: string
          month?: number
          recognition_key?: string
          student_no?: number
          year?: number
        }
        Relationships: []
      }
      exercise_records: {
        Row: {
          avg_accuracy: number | null
          avg_bpm: number | null
          avg_calories: number | null
          avg_duration_seconds: number | null
          avg_max_bpm: number | null
          created_at: string
          exercise_type: string
          id: string
          month: number
          record_count: number
          student_id: string
          updated_at: string
          year: number
        }
        Insert: {
          avg_accuracy?: number | null
          avg_bpm?: number | null
          avg_calories?: number | null
          avg_duration_seconds?: number | null
          avg_max_bpm?: number | null
          created_at?: string
          exercise_type: string
          id?: string
          month: number
          record_count?: number
          student_id: string
          updated_at?: string
          year: number
        }
        Update: {
          avg_accuracy?: number | null
          avg_bpm?: number | null
          avg_calories?: number | null
          avg_duration_seconds?: number | null
          avg_max_bpm?: number | null
          created_at?: string
          exercise_type?: string
          id?: string
          month?: number
          record_count?: number
          student_id?: string
          updated_at?: string
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "exercise_records_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "student_details"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exercise_records_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      grades: {
        Row: {
          created_at: string
          grade_number: number
          id: string
          school_id: string
          year: number
        }
        Insert: {
          created_at?: string
          grade_number: number
          id?: string
          school_id: string
          year?: number
        }
        Update: {
          created_at?: string
          grade_number?: number
          id?: string
          school_id?: string
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "grades_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      heart_rate_records: {
        Row: {
          avg_bpm: number | null
          created_at: string
          id: string
          max_bpm: number | null
          min_bpm: number | null
          month: number
          record_count: number
          student_id: string
          updated_at: string
          year: number
        }
        Insert: {
          avg_bpm?: number | null
          created_at?: string
          id?: string
          max_bpm?: number | null
          min_bpm?: number | null
          month: number
          record_count?: number
          student_id: string
          updated_at?: string
          year: number
        }
        Update: {
          avg_bpm?: number | null
          created_at?: string
          id?: string
          max_bpm?: number | null
          min_bpm?: number | null
          month?: number
          record_count?: number
          student_id?: string
          updated_at?: string
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "heart_rate_records_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "student_details"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "heart_rate_records_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id"]
          },
        ]
      }
      operator_accounts: {
        Row: {
          created_at: string | null
          id: string
          is_active: boolean
          password: string
          role: Database["public"]["Enums"]["operator_role"]
          school_id: string | null
          updated_at: string | null
          username: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_active?: boolean
          password: string
          role: Database["public"]["Enums"]["operator_role"]
          school_id?: string | null
          updated_at?: string | null
          username: string
        }
        Update: {
          created_at?: string | null
          id?: string
          is_active?: boolean
          password?: string
          role?: Database["public"]["Enums"]["operator_role"]
          school_id?: string | null
          updated_at?: string | null
          username?: string
        }
        Relationships: [
          {
            foreignKeyName: "operator_accounts_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      permission_logs: {
        Row: {
          action: string
          created_at: string
          grantee_id: string
          grantor_id: string
          id: string
          permission_type: string
        }
        Insert: {
          action: string
          created_at?: string
          grantee_id: string
          grantor_id: string
          id?: string
          permission_type: string
        }
        Update: {
          action?: string
          created_at?: string
          grantee_id?: string
          grantor_id?: string
          id?: string
          permission_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "permission_logs_grantee_id_fkey"
            columns: ["grantee_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "permission_logs_grantor_id_fkey"
            columns: ["grantor_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      school_contents: {
        Row: {
          content_id: string
          created_at: string
          end_date: string | null
          id: string
          is_unlimited: boolean | null
          school_id: string
          start_date: string | null
        }
        Insert: {
          content_id: string
          created_at?: string
          end_date?: string | null
          id?: string
          is_unlimited?: boolean | null
          school_id: string
          start_date?: string | null
        }
        Update: {
          content_id?: string
          created_at?: string
          end_date?: string | null
          id?: string
          is_unlimited?: boolean | null
          school_id?: string
          start_date?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "school_contents_content_id_fkey"
            columns: ["content_id"]
            isOneToOne: false
            referencedRelation: "contents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "school_contents_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      school_device_page_blocks: {
        Row: {
          body: string | null
          created_at: string
          id: string
          image_name: string | null
          image_original_path: string | null
          image_thumb_path: string | null
          page_id: string
          sort_order: number
          subtitle: string | null
          type: string
          updated_at: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          image_name?: string | null
          image_original_path?: string | null
          image_thumb_path?: string | null
          page_id: string
          sort_order?: number
          subtitle?: string | null
          type: string
          updated_at?: string
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          image_name?: string | null
          image_original_path?: string | null
          image_thumb_path?: string | null
          page_id?: string
          sort_order?: number
          subtitle?: string | null
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "school_device_page_blocks_page_id_fkey"
            columns: ["page_id"]
            isOneToOne: false
            referencedRelation: "school_device_pages"
            referencedColumns: ["id"]
          },
        ]
      }
      school_device_pages: {
        Row: {
          created_at: string
          id: string
          image_name: string | null
          image_original_path: string | null
          image_thumb_path: string | null
          kind: string
          name: string
          school_device_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          image_name?: string | null
          image_original_path?: string | null
          image_thumb_path?: string | null
          kind?: string
          name?: string
          school_device_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          image_name?: string | null
          image_original_path?: string | null
          image_thumb_path?: string | null
          kind?: string
          name?: string
          school_device_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "school_device_pages_school_device_id_fkey"
            columns: ["school_device_id"]
            isOneToOne: false
            referencedRelation: "school_devices"
            referencedColumns: ["id"]
          },
        ]
      }
      school_devices: {
        Row: {
          auth_key: string
          created_at: string
          device_id: string
          id: string
          is_primary: boolean
          link_group_id: string | null
          memo: string | null
          school_content_id: string
          status: string
          updated_at: string | null
        }
        Insert: {
          auth_key: string
          created_at?: string
          device_id: string
          id?: string
          is_primary?: boolean
          link_group_id?: string | null
          memo?: string | null
          school_content_id: string
          status?: string
          updated_at?: string | null
        }
        Update: {
          auth_key?: string
          created_at?: string
          device_id?: string
          id?: string
          is_primary?: boolean
          link_group_id?: string | null
          memo?: string | null
          school_content_id?: string
          status?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "school_devices_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "school_devices_school_content_id_fkey"
            columns: ["school_content_id"]
            isOneToOne: false
            referencedRelation: "school_contents"
            referencedColumns: ["id"]
          },
        ]
      }
      school_heart_rate_mappings: {
        Row: {
          created_at: string | null
          device_id: string
          id: string
          school_id: string
          student_no: number
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          device_id: string
          id?: string
          school_id: string
          student_no: number
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          device_id?: string
          id?: string
          school_id?: string
          student_no?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "school_heart_rate_mappings_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      schools: {
        Row: {
          created_at: string
          group_no: string
          id: string
          name: string
          recognition_key: string
          school_type: number
        }
        Insert: {
          created_at?: string
          group_no: string
          id?: string
          name: string
          recognition_key: string
          school_type?: number
        }
        Update: {
          created_at?: string
          group_no?: string
          id?: string
          name?: string
          recognition_key?: string
          school_type?: number
        }
        Relationships: []
      }
      students: {
        Row: {
          birth_date: string | null
          class_no: number
          created_at: string
          email: string | null
          gender: string | null
          grade: number
          height_cm: number | null
          id: string
          name: string
          notes: string | null
          school_id: string
          student_no: number
          updated_at: string
          weight_kg: number | null
          year: number
        }
        Insert: {
          birth_date?: string | null
          class_no: number
          created_at?: string
          email?: string | null
          gender?: string | null
          grade: number
          height_cm?: number | null
          id?: string
          name: string
          notes?: string | null
          school_id: string
          student_no: number
          updated_at?: string
          weight_kg?: number | null
          year?: number
        }
        Update: {
          birth_date?: string | null
          class_no?: number
          created_at?: string
          email?: string | null
          gender?: string | null
          grade?: number
          height_cm?: number | null
          id?: string
          name?: string
          notes?: string | null
          school_id?: string
          student_no?: number
          updated_at?: string
          weight_kg?: number | null
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "students_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
      user_profiles: {
        Row: {
          birth_date: string | null
          class_id: string | null
          created_at: string
          email: string
          full_name: string
          granted_at: string | null
          granted_by: string | null
          id: string
          is_active: boolean
          role: string
          school_id: string | null
          student_number: number | null
          updated_at: string
        }
        Insert: {
          birth_date?: string | null
          class_id?: string | null
          created_at?: string
          email?: string
          full_name: string
          granted_at?: string | null
          granted_by?: string | null
          id: string
          is_active?: boolean
          role: string
          school_id?: string | null
          student_number?: number | null
          updated_at?: string
        }
        Update: {
          birth_date?: string | null
          class_id?: string | null
          created_at?: string
          email?: string
          full_name?: string
          granted_at?: string | null
          granted_by?: string | null
          id?: string
          is_active?: boolean
          role?: string
          school_id?: string | null
          student_number?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_profiles_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_profiles_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_profiles_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      student_details: {
        Row: {
          birth_date: string | null
          class_no: number | null
          created_at: string | null
          email: string | null
          gender: string | null
          grade: number | null
          height_cm: number | null
          id: string | null
          name: string | null
          notes: string | null
          school_id: string | null
          school_name: string | null
          student_no: number | null
          updated_at: string | null
          weight_kg: number | null
          year: number | null
        }
        Relationships: [
          {
            foreignKeyName: "students_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      upsert_exercise_record_by_key: {
        Args: {
          p_avg_accuracy: number
          p_avg_bpm: number
          p_avg_calories: number
          p_avg_duration_seconds: number
          p_avg_max_bpm: number
          p_class_no: number
          p_exercise_type: string
          p_grade: number
          p_month: number
          p_recognition_key: string
          p_student_no: number
          p_year: number
        }
        Returns: string
      }
      upsert_exercise_record_by_key_idem: {
        Args: {
          p_avg_accuracy: number
          p_avg_bpm: number
          p_avg_calories: number
          p_avg_duration_seconds: number
          p_avg_max_bpm: number
          p_class_no: number
          p_exercise_type: string
          p_grade: number
          p_idempotency_key: string
          p_month: number
          p_recognition_key: string
          p_student_no: number
          p_year: number
        }
        Returns: boolean
      }
      upsert_exercise_records_batch: {
        Args: { p_items: Json }
        Returns: number
      }
    }
    Enums: {
      operator_role: "admin" | "school"
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
      operator_role: ["admin", "school"],
    },
  },
} as const
