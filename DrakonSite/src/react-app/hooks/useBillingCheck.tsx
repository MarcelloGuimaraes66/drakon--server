import { useState, useCallback } from "react";
import { brand } from "@/shared/brand";

interface BillingStatus {
  hasActiveSubscription: boolean;
  hasActiveCard: boolean;
  canAddCameras: boolean;
}

export function useBillingCheck() {
  const [isCheckingBilling, setIsCheckingBilling] = useState(false);
  const [showBillingModal, setShowBillingModal] = useState(false);

  const checkBillingForCameraCreation = useCallback(async (): Promise<boolean> => {
    if (!brand.features.billingEnabled) {
      return true;
    }
    setIsCheckingBilling(true);
    try {
      const response = await fetch("/api/billing/status");
      if (!response.ok) {
        throw new Error("Failed to check billing status");
      }

      const status: BillingStatus = await response.json();

      if (!status.canAddCameras) {
        // User doesn't have active subscription or saved card
        setShowBillingModal(true);
        return false;
      }

      // User has billing set up
      return true;
    } catch (error) {
      console.error("Failed to check billing status:", error);
      // On error, allow the action but log it
      return true;
    } finally {
      setIsCheckingBilling(false);
    }
  }, []);

  const closeBillingModal = useCallback(() => {
    setShowBillingModal(false);
  }, []);

  return {
    checkBillingForCameraCreation,
    isCheckingBilling,
    showBillingModal: brand.features.billingEnabled ? showBillingModal : false,
    closeBillingModal,
  };
}
