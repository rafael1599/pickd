export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: '14.1';
  };
  public: {
    Tables: {
      app_users: {
        Row: {
          age: number | null;
          created_at: string | null;
          email: string;
          full_name: string;
          id: string;
          role: string | null;
        };
        Insert: {
          age?: number | null;
          created_at?: string | null;
          email: string;
          full_name: string;
          id?: string;
          role?: string | null;
        };
        Update: {
          age?: number | null;
          created_at?: string | null;
          email?: string;
          full_name?: string;
          id?: string;
          role?: string | null;
        };
        Relationships: [];
      };
      asset_tags: {
        Row: {
          c_number: string | null;
          created_at: string | null;
          created_by: string | null;
          id: string;
          label_photo_url: string | null;
          location: string;
          made_in: string | null;
          order_id: string | null;
          other_notes: string | null;
          po_number: string | null;
          printed_at: string | null;
          public_token: string;
          serial_number: string | null;
          short_code: string;
          sku: string;
          status: string;
          upc: string | null;
          updated_at: string | null;
          warehouse: string;
        };
        Insert: {
          c_number?: string | null;
          created_at?: string | null;
          created_by?: string | null;
          id?: string;
          label_photo_url?: string | null;
          location?: string;
          made_in?: string | null;
          order_id?: string | null;
          other_notes?: string | null;
          po_number?: string | null;
          printed_at?: string | null;
          public_token?: string;
          serial_number?: string | null;
          short_code?: string;
          sku: string;
          status?: string;
          upc?: string | null;
          updated_at?: string | null;
          warehouse?: string;
        };
        Update: {
          c_number?: string | null;
          created_at?: string | null;
          created_by?: string | null;
          id?: string;
          label_photo_url?: string | null;
          location?: string;
          made_in?: string | null;
          order_id?: string | null;
          other_notes?: string | null;
          po_number?: string | null;
          printed_at?: string | null;
          public_token?: string;
          serial_number?: string | null;
          short_code?: string;
          sku?: string;
          status?: string;
          upc?: string | null;
          updated_at?: string | null;
          warehouse?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'asset_tags_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      customer_addresses: {
        Row: {
          city: string | null;
          created_at: string | null;
          customer_id: string;
          id: string;
          is_default: boolean | null;
          label: string | null;
          normalized_address: string | null;
          state: string | null;
          street: string;
          updated_at: string | null;
          zip_code: string | null;
        };
        Insert: {
          city?: string | null;
          created_at?: string | null;
          customer_id: string;
          id?: string;
          is_default?: boolean | null;
          label?: string | null;
          normalized_address?: string | null;
          state?: string | null;
          street: string;
          updated_at?: string | null;
          zip_code?: string | null;
        };
        Update: {
          city?: string | null;
          created_at?: string | null;
          customer_id?: string;
          id?: string;
          is_default?: boolean | null;
          label?: string | null;
          normalized_address?: string | null;
          state?: string | null;
          street?: string;
          updated_at?: string | null;
          zip_code?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'customer_addresses_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'customers';
            referencedColumns: ['id'];
          },
        ];
      };
      customers: {
        Row: {
          city: string | null;
          created_at: string | null;
          email: string | null;
          id: string;
          name: string;
          phone: string | null;
          state: string | null;
          street: string | null;
          updated_at: string | null;
          zip_code: string | null;
        };
        Insert: {
          city?: string | null;
          created_at?: string | null;
          email?: string | null;
          id?: string;
          name: string;
          phone?: string | null;
          state?: string | null;
          street?: string | null;
          updated_at?: string | null;
          zip_code?: string | null;
        };
        Update: {
          city?: string | null;
          created_at?: string | null;
          email?: string | null;
          id?: string;
          name?: string;
          phone?: string | null;
          state?: string | null;
          street?: string | null;
          updated_at?: string | null;
          zip_code?: string | null;
        };
        Relationships: [];
      };
      cycle_count_items: {
        Row: {
          adjustment_log_id: string | null;
          counted_at: string | null;
          counted_by: string | null;
          counted_qty: number | null;
          created_at: string | null;
          expected_qty: number | null;
          id: string;
          location: string | null;
          notes: string | null;
          session_id: string;
          sku: string;
          status: string;
          updated_at: string | null;
          variance: number | null;
          warehouse: string;
        };
        Insert: {
          adjustment_log_id?: string | null;
          counted_at?: string | null;
          counted_by?: string | null;
          counted_qty?: number | null;
          created_at?: string | null;
          expected_qty?: number | null;
          id?: string;
          location?: string | null;
          notes?: string | null;
          session_id: string;
          sku: string;
          status?: string;
          updated_at?: string | null;
          variance?: number | null;
          warehouse?: string;
        };
        Update: {
          adjustment_log_id?: string | null;
          counted_at?: string | null;
          counted_by?: string | null;
          counted_qty?: number | null;
          created_at?: string | null;
          expected_qty?: number | null;
          id?: string;
          location?: string | null;
          notes?: string | null;
          session_id?: string;
          sku?: string;
          status?: string;
          updated_at?: string | null;
          variance?: number | null;
          warehouse?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'cycle_count_items_counted_by_fkey';
            columns: ['counted_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'cycle_count_items_session_id_fkey';
            columns: ['session_id'];
            isOneToOne: false;
            referencedRelation: 'cycle_count_sessions';
            referencedColumns: ['id'];
          },
        ];
      };
      cycle_count_sessions: {
        Row: {
          assigned_to: string | null;
          completed_at: string | null;
          created_at: string | null;
          created_by: string;
          id: string;
          label: string | null;
          notes: string | null;
          reviewed_at: string | null;
          reviewed_by: string | null;
          source: string | null;
          started_at: string | null;
          status: string;
          total_counted: number | null;
          total_discrepancies: number | null;
          total_skus: number | null;
          updated_at: string | null;
          warehouse: string;
        };
        Insert: {
          assigned_to?: string | null;
          completed_at?: string | null;
          created_at?: string | null;
          created_by: string;
          id?: string;
          label?: string | null;
          notes?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          source?: string | null;
          started_at?: string | null;
          status?: string;
          total_counted?: number | null;
          total_discrepancies?: number | null;
          total_skus?: number | null;
          updated_at?: string | null;
          warehouse?: string;
        };
        Update: {
          assigned_to?: string | null;
          completed_at?: string | null;
          created_at?: string | null;
          created_by?: string;
          id?: string;
          label?: string | null;
          notes?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          source?: string | null;
          started_at?: string | null;
          status?: string;
          total_counted?: number | null;
          total_discrepancies?: number | null;
          total_skus?: number | null;
          updated_at?: string | null;
          warehouse?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'cycle_count_sessions_assigned_to_fkey';
            columns: ['assigned_to'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'cycle_count_sessions_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'cycle_count_sessions_reviewed_by_fkey';
            columns: ['reviewed_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      daily_inventory_snapshots: {
        Row: {
          created_at: string | null;
          id: number;
          location: string;
          location_id: string | null;
          quantity: number;
          sku: string;
          sku_note: string | null;
          snapshot_date: string;
          warehouse: string;
        };
        Insert: {
          created_at?: string | null;
          id?: number;
          location: string;
          location_id?: string | null;
          quantity: number;
          sku: string;
          sku_note?: string | null;
          snapshot_date: string;
          warehouse: string;
        };
        Update: {
          created_at?: string | null;
          id?: number;
          location?: string;
          location_id?: string | null;
          quantity?: number;
          sku?: string;
          sku_note?: string | null;
          snapshot_date?: string;
          warehouse?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'daily_inventory_snapshots_location_id_fkey';
            columns: ['location_id'];
            isOneToOne: false;
            referencedRelation: 'locations';
            referencedColumns: ['id'];
          },
        ];
      };
      daily_reports: {
        Row: {
          created_at: string;
          created_by: string | null;
          data_computed: Json;
          data_manual: Json;
          report_date: string;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          data_computed?: Json;
          data_manual?: Json;
          report_date: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          data_computed?: Json;
          data_manual?: Json;
          report_date?: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'daily_reports_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'daily_reports_updated_by_fkey';
            columns: ['updated_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      fedex_return_items: {
        Row: {
          condition: string;
          created_at: string | null;
          id: string;
          item_name: string | null;
          moved_at: string | null;
          moved_to_location: string | null;
          moved_to_warehouse: string | null;
          quantity: number;
          return_id: string;
          sku: string;
        };
        Insert: {
          condition?: string;
          created_at?: string | null;
          id?: string;
          item_name?: string | null;
          moved_at?: string | null;
          moved_to_location?: string | null;
          moved_to_warehouse?: string | null;
          quantity?: number;
          return_id: string;
          sku: string;
        };
        Update: {
          condition?: string;
          created_at?: string | null;
          id?: string;
          item_name?: string | null;
          moved_at?: string | null;
          moved_to_location?: string | null;
          moved_to_warehouse?: string | null;
          quantity?: number;
          return_id?: string;
          sku?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'fedex_return_items_return_id_fkey';
            columns: ['return_id'];
            isOneToOne: false;
            referencedRelation: 'fedex_returns';
            referencedColumns: ['id'];
          },
        ];
      };
      fedex_returns: {
        Row: {
          created_at: string | null;
          id: string;
          label_photo_url: string | null;
          notes: string | null;
          processed_at: string | null;
          processed_by: string | null;
          processed_by_name: string | null;
          received_at: string | null;
          received_by: string | null;
          received_by_name: string | null;
          resolved_at: string | null;
          status: string;
          tracking_number: string;
          updated_at: string | null;
        };
        Insert: {
          created_at?: string | null;
          id?: string;
          label_photo_url?: string | null;
          notes?: string | null;
          processed_at?: string | null;
          processed_by?: string | null;
          processed_by_name?: string | null;
          received_at?: string | null;
          received_by?: string | null;
          received_by_name?: string | null;
          resolved_at?: string | null;
          status?: string;
          tracking_number: string;
          updated_at?: string | null;
        };
        Update: {
          created_at?: string | null;
          id?: string;
          label_photo_url?: string | null;
          notes?: string | null;
          processed_at?: string | null;
          processed_by?: string | null;
          processed_by_name?: string | null;
          received_at?: string | null;
          received_by?: string | null;
          received_by_name?: string | null;
          resolved_at?: string | null;
          status?: string;
          tracking_number?: string;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'fedex_returns_processed_by_fkey';
            columns: ['processed_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'fedex_returns_received_by_fkey';
            columns: ['received_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      gallery_photos: {
        Row: {
          id: string;
          filename: string;
          url: string;
          thumbnail_url: string;
          caption: string | null;
          deleted_at: string | null;
          created_by: string | null;
          created_at: string | null;
        };
        Insert: {
          id?: string;
          filename: string;
          url: string;
          thumbnail_url: string;
          caption?: string | null;
          deleted_at?: string | null;
          created_by?: string | null;
          created_at?: string | null;
        };
        Update: {
          id?: string;
          filename?: string;
          url?: string;
          thumbnail_url?: string;
          caption?: string | null;
          deleted_at?: string | null;
          created_by?: string | null;
          created_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'gallery_photos_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      inventory: {
        Row: {
          capacity: number | null;
          created_at: string | null;
          distribution: Json | null;
          id: number;
          internal_note: string | null;
          is_active: boolean | null;
          item_name: string | null;
          location: string | null;
          location_hint: string | null;
          location_id: string | null;
          location_sort_key: number | null;
          quantity: number | null;
          sku: string;
          stowage_index: number | null;
          stowage_qty: number | null;
          stowage_type: string | null;
          sublocation: string[] | null;
          updated_at: string | null;
          warehouse: string | null;
        };
        Insert: {
          capacity?: number | null;
          created_at?: string | null;
          distribution?: Json | null;
          id?: number;
          internal_note?: string | null;
          is_active?: boolean | null;
          item_name?: string | null;
          location?: string | null;
          location_hint?: string | null;
          location_id?: string | null;
          location_sort_key?: number | null;
          quantity?: number | null;
          sku: string;
          stowage_index?: number | null;
          stowage_qty?: number | null;
          stowage_type?: string | null;
          sublocation?: string[] | null;
          updated_at?: string | null;
          warehouse?: string | null;
        };
        Update: {
          capacity?: number | null;
          created_at?: string | null;
          distribution?: Json | null;
          id?: number;
          internal_note?: string | null;
          is_active?: boolean | null;
          item_name?: string | null;
          location?: string | null;
          location_hint?: string | null;
          location_id?: string | null;
          location_sort_key?: number | null;
          sublocation?: string[] | null;
          quantity?: number | null;
          sku?: string;
          stowage_index?: number | null;
          stowage_qty?: number | null;
          stowage_type?: string | null;
          updated_at?: string | null;
          warehouse?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'inventory_location_id_fkey';
            columns: ['location_id'];
            isOneToOne: false;
            referencedRelation: 'locations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'inventory_sku_fkey';
            columns: ['sku'];
            isOneToOne: false;
            referencedRelation: 'sku_metadata';
            referencedColumns: ['sku'];
          },
        ];
      };
      inventory_logs: {
        Row: {
          action_type: string;
          created_at: string | null;
          from_location: string | null;
          from_warehouse: string | null;
          id: string;
          is_reversed: boolean | null;
          item_id: number | null;
          list_id: string | null;
          location_id: string | null;
          new_quantity: number | null;
          order_number: string | null;
          performed_by: string | null;
          prev_quantity: number | null;
          previous_quantity: number | null;
          previous_sku: string | null;
          quantity_change: number;
          sku: string;
          snapshot_before: Json | null;
          to_location: string | null;
          to_location_id: string | null;
          to_warehouse: string | null;
          user_id: string | null;
        };
        Insert: {
          action_type: string;
          created_at?: string | null;
          from_location?: string | null;
          from_warehouse?: string | null;
          id?: string;
          is_reversed?: boolean | null;
          item_id?: number | null;
          list_id?: string | null;
          location_id?: string | null;
          new_quantity?: number | null;
          order_number?: string | null;
          performed_by?: string | null;
          prev_quantity?: number | null;
          previous_quantity?: number | null;
          previous_sku?: string | null;
          quantity_change: number;
          sku: string;
          snapshot_before?: Json | null;
          to_location?: string | null;
          to_location_id?: string | null;
          to_warehouse?: string | null;
          user_id?: string | null;
        };
        Update: {
          action_type?: string;
          created_at?: string | null;
          from_location?: string | null;
          from_warehouse?: string | null;
          id?: string;
          is_reversed?: boolean | null;
          item_id?: number | null;
          list_id?: string | null;
          location_id?: string | null;
          new_quantity?: number | null;
          order_number?: string | null;
          performed_by?: string | null;
          prev_quantity?: number | null;
          previous_quantity?: number | null;
          previous_sku?: string | null;
          quantity_change?: number;
          sku?: string;
          snapshot_before?: Json | null;
          to_location?: string | null;
          to_location_id?: string | null;
          to_warehouse?: string | null;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'inventory_logs_list_id_fkey';
            columns: ['list_id'];
            isOneToOne: false;
            referencedRelation: 'picking_lists';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'inventory_logs_location_id_fkey';
            columns: ['location_id'];
            isOneToOne: false;
            referencedRelation: 'locations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'inventory_logs_to_location_id_fkey';
            columns: ['to_location_id'];
            isOneToOne: false;
            referencedRelation: 'locations';
            referencedColumns: ['id'];
          },
        ];
      };
      locations: {
        Row: {
          bike_line: number | null;
          created_at: string | null;
          id: string;
          is_active: boolean | null;
          is_shipping_area: boolean | null;
          length_ft: number | null;
          location: string;
          max_capacity: number | null;
          notes: string | null;
          picking_order: number | null;
          total_bikes: number | null;
          updated_at: string | null;
          warehouse: string;
          zone: string | null;
        };
        Insert: {
          bike_line?: number | null;
          created_at?: string | null;
          id?: string;
          is_active?: boolean | null;
          is_shipping_area?: boolean | null;
          length_ft?: number | null;
          location: string;
          max_capacity?: number | null;
          notes?: string | null;
          picking_order?: number | null;
          total_bikes?: number | null;
          updated_at?: string | null;
          warehouse: string;
          zone?: string | null;
        };
        Update: {
          bike_line?: number | null;
          created_at?: string | null;
          id?: string;
          is_active?: boolean | null;
          is_shipping_area?: boolean | null;
          length_ft?: number | null;
          location?: string;
          max_capacity?: number | null;
          notes?: string | null;
          picking_order?: number | null;
          total_bikes?: number | null;
          updated_at?: string | null;
          warehouse?: string;
          zone?: string | null;
        };
        Relationships: [];
      };
      optimization_reports: {
        Row: {
          applied_count: number | null;
          generated_at: string | null;
          id: number;
          report_date: string;
          report_type: string | null;
          suggestions: Json;
          total_suggestions: number;
        };
        Insert: {
          applied_count?: number | null;
          generated_at?: string | null;
          id?: number;
          report_date?: string;
          report_type?: string | null;
          suggestions: Json;
          total_suggestions: number;
        };
        Update: {
          applied_count?: number | null;
          generated_at?: string | null;
          id?: number;
          report_date?: string;
          report_type?: string | null;
          suggestions?: Json;
          total_suggestions?: number;
        };
        Relationships: [];
      };
      order_groups: {
        Row: {
          created_at: string | null;
          group_type: string;
          id: string;
        };
        Insert: {
          created_at?: string | null;
          group_type?: string;
          id?: string;
        };
        Update: {
          created_at?: string | null;
          group_type?: string;
          id?: string;
        };
        Relationships: [];
      };
      pdf_import_log: {
        Row: {
          error_message: string | null;
          file_name: string;
          id: string;
          items_count: number | null;
          order_number: string | null;
          pdf_hash: string;
          picking_list_id: string | null;
          processed_at: string | null;
          status: string | null;
        };
        Insert: {
          error_message?: string | null;
          file_name: string;
          id?: string;
          items_count?: number | null;
          order_number?: string | null;
          pdf_hash: string;
          picking_list_id?: string | null;
          processed_at?: string | null;
          status?: string | null;
        };
        Update: {
          error_message?: string | null;
          file_name?: string;
          id?: string;
          items_count?: number | null;
          order_number?: string | null;
          pdf_hash?: string;
          picking_list_id?: string | null;
          processed_at?: string | null;
          status?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'pdf_import_log_picking_list_id_fkey';
            columns: ['picking_list_id'];
            isOneToOne: false;
            referencedRelation: 'picking_lists';
            referencedColumns: ['id'];
          },
        ];
      };
      picking_list_notes: {
        Row: {
          created_at: string;
          id: string;
          list_id: string;
          message: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          list_id: string;
          message: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          list_id?: string;
          message?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'picking_list_notes_list_id_fkey';
            columns: ['list_id'];
            isOneToOne: false;
            referencedRelation: 'picking_lists';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'picking_list_notes_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      picking_lists: {
        Row: {
          checked_by: string | null;
          combine_meta: Json | null;
          completed_snapshot: Json | null;
          correction_notes: string | null;
          created_at: string | null;
          customer_id: string | null;
          group_id: string | null;
          id: string;
          is_addon: boolean | null;
          is_waiting_inventory: boolean;
          items: Json | null;
          last_activity_at: string | null;
          load_number: string | null;
          notes: string | null;
          order_number: string | null;
          pallet_photos: Json | null;
          pallets_qty: number | null;
          priority: string | null;
          reopen_count: number | null;
          reopened_at: string | null;
          reopened_by: string | null;
          shipping_type: string | null;
          source: string | null;
          status: string | null;
          total_units: number | null;
          total_weight_lbs: number | null;
          transport_company: string | null;
          updated_at: string | null;
          user_id: string;
          waiting_reason: string | null;
          waiting_since: string | null;
        };
        Insert: {
          checked_by?: string | null;
          combine_meta?: Json | null;
          completed_snapshot?: Json | null;
          correction_notes?: string | null;
          created_at?: string | null;
          customer_id?: string | null;
          group_id?: string | null;
          id?: string;
          is_addon?: boolean | null;
          is_waiting_inventory?: boolean;
          items?: Json | null;
          last_activity_at?: string | null;
          load_number?: string | null;
          notes?: string | null;
          order_number?: string | null;
          pallet_photos?: Json | null;
          pallets_qty?: number | null;
          priority?: string | null;
          reopen_count?: number | null;
          reopened_at?: string | null;
          reopened_by?: string | null;
          shipping_type?: string | null;
          source?: string | null;
          status?: string | null;
          total_units?: number | null;
          total_weight_lbs?: number | null;
          transport_company?: string | null;
          updated_at?: string | null;
          user_id: string;
          waiting_reason?: string | null;
          waiting_since?: string | null;
        };
        Update: {
          checked_by?: string | null;
          combine_meta?: Json | null;
          completed_snapshot?: Json | null;
          correction_notes?: string | null;
          created_at?: string | null;
          customer_id?: string | null;
          group_id?: string | null;
          id?: string;
          is_addon?: boolean | null;
          is_waiting_inventory?: boolean;
          items?: Json | null;
          last_activity_at?: string | null;
          load_number?: string | null;
          notes?: string | null;
          order_number?: string | null;
          pallet_photos?: Json | null;
          pallets_qty?: number | null;
          priority?: string | null;
          reopen_count?: number | null;
          reopened_at?: string | null;
          reopened_by?: string | null;
          shipping_type?: string | null;
          source?: string | null;
          status?: string | null;
          total_units?: number | null;
          total_weight_lbs?: number | null;
          transport_company?: string | null;
          updated_at?: string | null;
          user_id?: string;
          waiting_reason?: string | null;
          waiting_since?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'picking_lists_checked_by_fkey';
            columns: ['checked_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'picking_lists_customer_id_fkey';
            columns: ['customer_id'];
            isOneToOne: false;
            referencedRelation: 'customers';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'picking_lists_group_id_fkey';
            columns: ['group_id'];
            isOneToOne: false;
            referencedRelation: 'order_groups';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'picking_lists_presence_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'user_presence';
            referencedColumns: ['user_id'];
          },
          {
            foreignKeyName: 'picking_lists_reopened_by_fkey';
            columns: ['reopened_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'picking_lists_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      profiles: {
        Row: {
          created_at: string | null;
          created_by: string | null;
          email: string | null;
          full_name: string | null;
          id: string;
          is_active: boolean | null;
          last_seen_at: string | null;
          role: string | null;
          updated_at: string | null;
        };
        Insert: {
          created_at?: string | null;
          created_by?: string | null;
          email?: string | null;
          full_name?: string | null;
          id: string;
          is_active?: boolean | null;
          last_seen_at?: string | null;
          role?: string | null;
          updated_at?: string | null;
        };
        Update: {
          created_at?: string | null;
          created_by?: string | null;
          email?: string | null;
          full_name?: string | null;
          id?: string;
          is_active?: boolean | null;
          last_seen_at?: string | null;
          role?: string | null;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'profiles_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      project_tasks: {
        Row: {
          created_at: string | null;
          created_by: string | null;
          id: string;
          note: string | null;
          position: number;
          status: string;
          title: string;
          updated_at: string | null;
        };
        Insert: {
          created_at?: string | null;
          created_by?: string | null;
          id?: string;
          note?: string | null;
          position?: number;
          status?: string;
          title: string;
          updated_at?: string | null;
        };
        Update: {
          created_at?: string | null;
          created_by?: string | null;
          id?: string;
          note?: string | null;
          position?: number;
          status?: string;
          title?: string;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'project_tasks_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      sku_metadata: {
        Row: {
          category: string | null;
          color: string | null;
          condition: string | null;
          condition_description: string | null;
          created_at: string;
          height_in: number | null;
          image_url: string | null;
          is_bike: boolean | null;
          is_scratch_dent: boolean;
          length_ft: number | null;
          length_in: number | null;
          model: string | null;
          msrp: number | null;
          pdf_link: string | null;
          sd_category: string | null;
          sd_price: number | null;
          serial_number: string | null;
          size: string | null;
          sku: string;
          standard_price: number | null;
          upc: string | null;
          weight_lbs: number | null;
          width_in: number | null;
        };
        Insert: {
          category?: string | null;
          color?: string | null;
          condition?: string | null;
          condition_description?: string | null;
          created_at?: string;
          height_in?: number | null;
          image_url?: string | null;
          is_bike?: boolean | null;
          is_scratch_dent?: boolean;
          length_ft?: number | null;
          length_in?: number | null;
          model?: string | null;
          msrp?: number | null;
          pdf_link?: string | null;
          sd_category?: string | null;
          sd_price?: number | null;
          serial_number?: string | null;
          size?: string | null;
          sku: string;
          standard_price?: number | null;
          upc?: string | null;
          weight_lbs?: number | null;
          width_in?: number | null;
        };
        Update: {
          category?: string | null;
          color?: string | null;
          condition?: string | null;
          condition_description?: string | null;
          created_at?: string;
          height_in?: number | null;
          image_url?: string | null;
          is_bike?: boolean | null;
          is_scratch_dent?: boolean;
          length_ft?: number | null;
          length_in?: number | null;
          model?: string | null;
          msrp?: number | null;
          pdf_link?: string | null;
          sd_category?: string | null;
          sd_price?: number | null;
          serial_number?: string | null;
          size?: string | null;
          sku?: string;
          standard_price?: number | null;
          upc?: string | null;
          weight_lbs?: number | null;
          width_in?: number | null;
        };
        Relationships: [];
      };
      task_state_changes: {
        Row: {
          changed_at: string | null;
          changed_by: string | null;
          from_status: string;
          id: string;
          task_id: string;
          to_status: string;
        };
        Insert: {
          changed_at?: string | null;
          changed_by?: string | null;
          from_status: string;
          id?: string;
          task_id: string;
          to_status: string;
        };
        Update: {
          changed_at?: string | null;
          changed_by?: string | null;
          from_status?: string;
          id?: string;
          task_id?: string;
          to_status?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'task_state_changes_changed_by_fkey';
            columns: ['changed_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'task_state_changes_task_id_fkey';
            columns: ['task_id'];
            isOneToOne: false;
            referencedRelation: 'project_tasks';
            referencedColumns: ['id'];
          },
        ];
      };
      task_photos: {
        Row: {
          id: string;
          task_id: string;
          photo_id: string;
          assigned_by: string | null;
          assigned_at: string | null;
        };
        Insert: {
          id?: string;
          task_id: string;
          photo_id: string;
          assigned_by?: string | null;
          assigned_at?: string | null;
        };
        Update: {
          id?: string;
          task_id?: string;
          photo_id?: string;
          assigned_by?: string | null;
          assigned_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'task_photos_task_id_fkey';
            columns: ['task_id'];
            isOneToOne: false;
            referencedRelation: 'project_tasks';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'task_photos_photo_id_fkey';
            columns: ['photo_id'];
            isOneToOne: false;
            referencedRelation: 'gallery_photos';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'task_photos_assigned_by_fkey';
            columns: ['assigned_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      user_presence: {
        Row: {
          created_at: string;
          last_seen_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          last_seen_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          last_seen_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'user_presence_profiles_id_fkey';
            columns: ['user_id'];
            isOneToOne: true;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      adjust_distribution: {
        Args: { p_item_id: number; p_qty_to_deduct: number };
        Returns: Json;
      };
      adjust_inventory_quantity: {
        Args: {
          p_delta: number;
          p_internal_note?: string;
          p_list_id?: string;
          p_location: string;
          p_merge_note?: string;
          p_order_number?: string;
          p_performed_by: string;
          p_skip_log?: boolean;
          p_sku: string;
          p_user_id: string;
          p_user_role?: string;
          p_warehouse: string;
        };
        Returns: Json;
      };
      auto_cancel_stale_orders: {
        Args: never;
        Returns: {
          id: string;
          order_number: string;
          status: string;
        }[];
      };
      calculate_bike_distribution: {
        Args: { p_qty: number; p_sku: string };
        Returns: Json;
      };
      cancel_reopen: {
        Args: { p_list_id: string; p_user_id: string };
        Returns: boolean;
      };
      compute_daily_report_data: {
        Args: { p_report_date: string };
        Returns: Json;
      };
      create_daily_report_snapshot: {
        Args: { p_report_date: string };
        Returns: Json;
      };
      create_daily_snapshot: {
        Args: { p_snapshot_date?: string };
        Returns: Json;
      };
      current_ny_date: { Args: never; Returns: string };
      current_user_id: { Args: never; Returns: string };
      delete_inventory_item: {
        Args: { p_item_id: number; p_performed_by: string; p_user_id?: string };
        Returns: boolean;
      };
      generate_short_code: { Args: never; Returns: string };
      get_daily_activity_report: { Args: { p_date: string }; Returns: Json };
      get_inventory_stats: {
        Args: { p_include_parts?: boolean };
        Returns: {
          total_skus: number;
          total_units: number;
        }[];
      };
      get_public_tag: {
        Args: { p_short_code: string; p_token: string };
        Returns: Json;
      };
      get_snapshot: {
        Args: { p_target_date: string };
        Returns: {
          location: string;
          location_id: string;
          quantity: number;
          sku: string;
          sku_note: string;
          warehouse: string;
        }[];
      };
      get_snapshot_summary: { Args: { p_target_date?: string }; Returns: Json };
      get_stock_at_timestamp: {
        Args: { target_timestamp: string };
        Returns: {
          location: string;
          quantity: number;
          sku: string;
          warehouse: string;
        }[];
      };
      is_admin: { Args: never; Returns: boolean };
      is_manager: { Args: never; Returns: boolean };
      is_user_online: { Args: { p_user_id: string }; Returns: boolean };
      mark_picking_list_waiting: {
        Args: { p_list_id: string; p_reason: string };
        Returns: undefined;
      };
      move_inventory_stock: {
        Args: {
          p_from_location: string;
          p_from_warehouse: string;
          p_internal_note?: string;
          p_performed_by: string;
          p_qty: number;
          p_sku: string;
          p_to_location: string;
          p_to_warehouse: string;
          p_user_id?: string;
          p_user_role?: string;
          p_sublocation?: string[];
        };
        Returns: Json;
      };
      ny_day_bounds: {
        Args: { p_ny_date: string };
        Returns: {
          ends_at: string;
          starts_at: string;
        }[];
      };
      process_picking_list: {
        Args: {
          p_list_id: string;
          p_pallets_qty?: number;
          p_performed_by: string;
          p_total_units?: number;
          p_user_id?: string;
          p_user_role?: string;
        };
        Returns: boolean;
      };
      recomplete_picking_list: {
        Args: {
          p_list_id: string;
          p_pallets_qty?: number;
          p_performed_by: string;
          p_total_units?: number;
          p_user_id: string;
          p_user_role?: string;
        };
        Returns: boolean;
      };
      register_new_sku: {
        Args: {
          p_item_name: string;
          p_location?: string;
          p_sku: string;
          p_warehouse?: string;
        };
        Returns: Json;
      };
      reopen_picking_list: {
        Args: { p_list_id: string; p_reason?: string; p_reopened_by: string };
        Returns: boolean;
      };
      resolve_location: {
        Args: {
          p_location_name: string;
          p_user_role?: string;
          p_warehouse: string;
        };
        Returns: string;
      };
      search_inventory_with_metadata: {
        Args: {
          p_search?: string;
          p_warehouse?: string;
          p_include_inactive?: boolean;
          p_show_parts?: boolean;
          p_only_scratch_dent?: boolean;
          p_offset?: number;
          p_limit?: number;
        };
        Returns: {
          id: number;
          sku: string;
          quantity: number;
          location: string | null;
          location_id: string | null;
          sublocation: string[] | null;
          item_name: string | null;
          warehouse: string | null;
          is_active: boolean | null;
          internal_note: string | null;
          distribution: Json | null;
          created_at: string;
          location_sort_key: number | null;
          image_url: string | null;
          length_in: number | null;
          width_in: number | null;
          height_in: number | null;
          weight_lbs: number | null;
          is_bike: boolean | null;
          is_scratch_dent: boolean | null;
          serial_number: string | null;
          upc: string | null;
          model: string | null;
          condition_description: string | null;
          total_count: number;
        }[];
      };
      save_daily_report_manual: {
        Args: { p_manual: Json; p_report_date: string };
        Returns: undefined;
      };
      show_limit: { Args: never; Returns: number };
      show_trgm: { Args: { '': string }; Returns: string[] };
      take_over_sku_from_waiting: {
        Args: {
          p_qty: number;
          p_sku: string;
          p_target_list_id: string;
          p_waiting_list_id: string;
        };
        Returns: undefined;
      };
      undo_inventory_action: { Args: { target_log_id: string }; Returns: Json };
      unmark_picking_list_waiting: {
        Args: { p_action: string; p_list_id: string };
        Returns: undefined;
      };
      update_user_presence: { Args: { p_user_id: string }; Returns: undefined };
      upsert_inventory_log: {
        Args: {
          p_action_type: string;
          p_from_location: string;
          p_from_warehouse: string;
          p_is_reversed?: boolean;
          p_item_id: number;
          p_list_id?: string;
          p_location_id: string;
          p_new_quantity: number;
          p_order_number?: string;
          p_performed_by: string;
          p_prev_quantity: number;
          p_quantity_change: number;
          p_sku: string;
          p_snapshot_before?: Json;
          p_to_location: string;
          p_to_location_id: string;
          p_to_warehouse: string;
          p_user_id: string;
        };
        Returns: string;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] & DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema['Tables']
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema['Tables']
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema['Enums']
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema['CompositeTypes']
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {},
  },
} as const;
