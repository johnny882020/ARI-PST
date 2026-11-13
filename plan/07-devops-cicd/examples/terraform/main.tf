# Terraform only for what the Render Blueprint cannot do: DNS, CDN/WAF, KMS, monitoring.
# Provider and resource names below are ILLUSTRATIVE. Pick vendors by ADR (UNVERIFIED).
terraform {
  required_version = ">= 1.9"
  required_providers {
    cloudflare = { source = "cloudflare/cloudflare", version = "~> 4.40" }
    aws        = { source = "hashicorp/aws", version = "~> 5.70" }
  }
  backend "s3" {}   # remote state, encrypted, state locking. Config passed with -backend-config.
}

variable "region" {
  type        = string
  description = "Storage/compute region pin. GATE-REGION default: EU (Frankfurt)."
  default     = "eu-central-1"
  validation {
    condition     = contains(["eu-central-1"], var.region)
    error_message = "Region is pinned by GATE-REGION. Change only through an ADR."
  }
}
variable "zone_id" { type = string }
variable "domain" {
  type    = string
  default = "portal.example.org"
}
variable "render_public_cname" { type = string }
variable "render_app_cname" { type = string }

provider "aws" { region = var.region }
provider "cloudflare" {}   # API token from environment, never in Git

# DNS
resource "cloudflare_record" "public" {
  zone_id = var.zone_id
  name    = "www"
  type    = "CNAME"
  content = var.render_public_cname
  proxied = true
}
resource "cloudflare_record" "app" {
  zone_id = var.zone_id
  name    = "app"
  type    = "CNAME"
  content = var.render_app_cname
  proxied = true
}

# WAF baseline: managed rules + rate limit on login
resource "cloudflare_ruleset" "waf_rate_limit_login" {
  zone_id = var.zone_id
  name    = "ari-login-rate-limit"
  kind    = "zone"
  phase   = "http_ratelimit"
  rules {
    action = "block"
    expression  = "(http.request.uri.path eq \"/api/v1/auth/login\")"
    description = "Limit login attempts"
    ratelimit {
      characteristics     = ["ip.src"]
      period              = 60
      requests_per_period = 20
      mitigation_timeout  = 600
    }
  }
}

# KMS key for the encrypted backup export (cron ari-cron-backup-export)
resource "aws_kms_key" "backup" {
  description             = "ARI-PST backup export key"
  enable_key_rotation     = true
  deletion_window_in_days = 30
}
resource "aws_s3_bucket" "backup" {
  bucket = "ari-pst-backup-export-example"
}
resource "aws_s3_bucket_server_side_encryption_configuration" "backup" {
  bucket = aws_s3_bucket.backup.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.backup.arn
    }
  }
}
resource "aws_s3_bucket_public_access_block" "backup" {
  bucket                  = aws_s3_bucket.backup.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
resource "aws_s3_bucket_versioning" "backup" {
  bucket = aws_s3_bucket.backup.id
  versioning_configuration { status = "Enabled" }
}
