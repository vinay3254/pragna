from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from app import repository
from app.auth import get_current_user

router = APIRouter(prefix="/api/billing", tags=["billing"])

# Fixed Pro plan pricing in paise (₹299 = 29900 paise)
PRO_PLAN_AMOUNT_PAISE = 29900
CURRENCY = "INR"
DEFAULT_PROVIDER = "demo"


class ConfirmPaymentRequest(BaseModel):
    order_id: int


@router.post("/create-order")
async def create_order(request: Request, current_user: dict = Depends(get_current_user)):
    """
    Creates a new subscription order for the authenticated user.
    The amount is strictly set server-side (PRO_PLAN_AMOUNT_PAISE = 29900).
    Returns order details mirroring a real payment gateway order creation.
    """
    conn = request.app.state.conn
    user_id = current_user["id"]

    order_id = repository.create_subscription_order(
        conn=conn,
        user_id=user_id,
        plan="pro",
        amount_paise=PRO_PLAN_AMOUNT_PAISE,
        provider=DEFAULT_PROVIDER,
    )

    return {
        "order_id": order_id,
        "amount": PRO_PLAN_AMOUNT_PAISE,
        "currency": CURRENCY,
        "provider": DEFAULT_PROVIDER,
    }


@router.post("/confirm-demo-payment")
async def confirm_demo_payment(
    request: Request,
    body: ConfirmPaymentRequest,
    current_user: dict = Depends(get_current_user),
):
    """
    DEMO ONLY: Simulates payment gateway webhook/verification callback.
    Validates that the order exists for the user and is in 'created' status,
    marks it 'paid', sets a 30-day validity period, and upgrades the user to 'pro'.
    Replace/remove this route when integrating a real payment gateway (e.g. Razorpay/Stripe).
    """
    conn = request.app.state.conn
    user_id = current_user["id"]

    sub = repository.get_subscription(conn, body.order_id, user_id)
    if not sub:
        raise HTTPException(status_code=404, detail="Order not found")

    if sub["status"] != "created":
        raise HTTPException(
            status_code=400,
            detail=f"Order cannot be confirmed because status is '{sub['status']}'",
        )

    # Calculate 30 days period from now
    current_period_end = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()

    success = repository.mark_subscription_paid(
        conn=conn,
        subscription_id=body.order_id,
        user_id=user_id,
        plan=sub["plan"] or "pro",
        current_period_end=current_period_end,
    )

    if not success:
        raise HTTPException(status_code=500, detail="Failed to activate subscription")

    return {
        "success": True,
        "plan": sub["plan"] or "pro",
        "current_period_end": current_period_end,
    }


@router.get("/status")
async def billing_status(
    request: Request, current_user: dict = Depends(get_current_user)
):
    """
    Returns the active subscription plan and period end date for the user.
    If the subscription period has expired, automatically reconciles stored plan to 'free'.
    """
    conn = request.app.state.conn
    user_id = current_user["id"]

    status = repository.get_user_subscription_status(conn, user_id)
    return status
