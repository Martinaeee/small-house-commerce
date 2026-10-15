import {
  PermissionCode,
  RoleCode,
  type PermissionCode as PermissionCodeType,
  type RoleCode as RoleCodeType,
} from '../src/generated/prisma/client.js';

export const RBAC_PERMISSIONS: {
  code: PermissionCodeType;
  description: string;
}[] = [
  {
    code: PermissionCode.ORDER_VIEW_ALL,
    description: 'View every order regardless of optimizer.',
  },
  {
    code: PermissionCode.ORDER_VIEW_OWN,
    description: 'View only orders attributed to the current optimizer.',
  },
  { code: PermissionCode.ORDER_CONFIRM, description: 'Confirm a COD order.' },
  {
    code: PermissionCode.ORDER_CANCEL,
    description: 'Cancel an order, including risky ones.',
  },
  {
    code: PermissionCode.ORDER_CHANGE_AID,
    description: 'Change the AID attribution of an order.',
  },
  {
    code: PermissionCode.CUSTOMER_RISK_VIEW,
    description: 'View customer risk events and history.',
  },
  {
    code: PermissionCode.CUSTOMER_RISK_EDIT,
    description: 'Create or edit customer risk events.',
  },
  { code: PermissionCode.INVENTORY_VIEW, description: 'View stock levels.' },
  {
    code: PermissionCode.INVENTORY_ADJUST,
    description: 'Manually adjust stock.',
  },
  {
    code: PermissionCode.SHIPMENT_CREATE,
    description: 'Create shipments and update shipment status.',
  },
  {
    code: PermissionCode.REPORT_PROFIT_VIEW,
    description: 'View company profit and profit reports.',
  },
  {
    code: PermissionCode.SYSTEM_SETTINGS_EDIT,
    description: 'Edit system and security configuration.',
  },
  {
    code: PermissionCode.PRODUCT_MANAGE,
    description: 'Manage products, variants, SKUs, categories and suppliers.',
  },
  {
    code: PermissionCode.CUSTOMER_MANAGE,
    description: 'Manage customer profiles and addresses.',
  },
  {
    code: PermissionCode.CAMPAIGN_LINK_BUILD,
    description: 'Build public product, variant and attribution links.',
  },
  {
    code: PermissionCode.NEWSLETTER_READ,
    description: 'View newsletter subscribers.',
  },
  {
    code: PermissionCode.NEWSLETTER_WRITE,
    description: 'Manage newsletter subscribers.',
  },
  {
    code: PermissionCode.MARKETING_VIEW_OWN,
    description: 'View the marketing pages, links and spend the account owns.',
  },
  {
    code: PermissionCode.MARKETING_MANAGE_OWN,
    description: 'Create, edit, publish and disable the account’s own marketing.',
  },
  {
    code: PermissionCode.MARKETING_VIEW_ALL,
    description: 'View every optimizer’s marketing pages, links and spend.',
  },
  {
    code: PermissionCode.MARKETING_MANAGE_ALL,
    description: 'Manage every optimizer’s marketing pages, links and spend.',
  },
  {
    code: PermissionCode.STOREFRONT_SHELL_MANAGE,
    description:
      'Edit and publish the storefront Header, Footer, brand marks and base theme.',
  },
  {
    code: PermissionCode.PRODUCT_FAQ_SHARED_MANAGE,
    description: 'Edit the site-wide shared FAQ library every product may use.',
  },
];

const ALL_PERMISSIONS: PermissionCodeType[] = RBAC_PERMISSIONS.map(
  (permission) => permission.code,
);

export const RBAC_GRANTS: Record<RoleCodeType, PermissionCodeType[]> = {
  [RoleCode.SUPER_ADMIN]: ALL_PERMISSIONS,

  [RoleCode.ADMIN]: [
    PermissionCode.ORDER_VIEW_ALL,
    PermissionCode.ORDER_CONFIRM,
    PermissionCode.ORDER_CANCEL,
    PermissionCode.ORDER_CHANGE_AID,
    PermissionCode.CUSTOMER_RISK_VIEW,
    PermissionCode.CUSTOMER_RISK_EDIT,
    PermissionCode.INVENTORY_VIEW,
    PermissionCode.INVENTORY_ADJUST,
    PermissionCode.SHIPMENT_CREATE,
    PermissionCode.REPORT_PROFIT_VIEW,
    PermissionCode.PRODUCT_MANAGE,
    // Editing one product must not silently rewrite every product's FAQ.
    PermissionCode.PRODUCT_FAQ_SHARED_MANAGE,
    PermissionCode.CUSTOMER_MANAGE,
    PermissionCode.CAMPAIGN_LINK_BUILD,
    PermissionCode.NEWSLETTER_READ,
    PermissionCode.NEWSLETTER_WRITE,
    PermissionCode.MARKETING_VIEW_OWN,
    PermissionCode.MARKETING_MANAGE_OWN,
    PermissionCode.MARKETING_VIEW_ALL,
    PermissionCode.MARKETING_MANAGE_ALL,
    // deliberately not SYSTEM_SETTINGS_EDIT
  ],

  [RoleCode.OPTIMIZER]: [
    PermissionCode.ORDER_VIEW_OWN,
    PermissionCode.CAMPAIGN_LINK_BUILD,
    PermissionCode.MARKETING_VIEW_OWN,
    PermissionCode.MARKETING_MANAGE_OWN,
    // deliberately not REPORT_PROFIT_VIEW, not ORDER_VIEW_ALL
  ],

  [RoleCode.CONFIRMOR]: [
    PermissionCode.ORDER_VIEW_ALL,
    PermissionCode.ORDER_CONFIRM,
    PermissionCode.ORDER_CANCEL,
    PermissionCode.CUSTOMER_RISK_VIEW,
    PermissionCode.CUSTOMER_RISK_EDIT,
    // deliberately not INVENTORY_ADJUST, not REPORT_PROFIT_VIEW
  ],

  [RoleCode.WAREHOUSE]: [
    PermissionCode.ORDER_VIEW_ALL,
    PermissionCode.INVENTORY_VIEW,
    PermissionCode.SHIPMENT_CREATE,
    // deliberately not ORDER_CHANGE_AID, not REPORT_PROFIT_VIEW, not INVENTORY_ADJUST
  ],

  [RoleCode.FINANCE]: [
    PermissionCode.ORDER_VIEW_ALL,
    PermissionCode.REPORT_PROFIT_VIEW,
    PermissionCode.MARKETING_VIEW_ALL,
    // deliberately no write permissions
  ],
};
