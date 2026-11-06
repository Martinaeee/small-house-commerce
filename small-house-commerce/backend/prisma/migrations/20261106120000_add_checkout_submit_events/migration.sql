-- Two events that close the checkout blind spot: an attempt records that the
-- shopper pressed a submit control and the browser let the request through;
-- the failure twin records why it did not become an order.
ALTER TYPE "AnalyticsEventName" ADD VALUE IF NOT EXISTS 'CHECKOUT_SUBMIT_ATTEMPT';
ALTER TYPE "AnalyticsEventName" ADD VALUE IF NOT EXISTS 'CHECKOUT_SUBMIT_FAILED';
