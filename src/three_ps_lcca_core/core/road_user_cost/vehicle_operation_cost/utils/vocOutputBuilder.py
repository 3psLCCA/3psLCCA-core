import warnings
from typing import Dict, Any
from .... import standard_keys as c


def nn(x: float, label: str = "unknown", description: str = "") -> float:
    if x < 0:
        desc_line = f" {description}" if description else ""
        warnings.warn(
            f"WARNING: '{label}' computed as {x:.4f}, which is negative.{desc_line} "
            "Check the input parameters for this vehicle type.",
            UserWarning,
            stacklevel=2,
        )
    return x


def build_voc_output(
    vt: str,
    i_lane: str,
    lane: str,
    velocity: float,
    petrol: float,
    diesel: float,
    SP_ET: float,
    SP_IT: float,
    ML: float,
    TL: float,
    EOL: float,
    OL: float,
    G: float,
    FXC_ET: float,
    FXC_IT: float,
    DC_ET: float,
    DC_IT: float,
    PT: float,
    crew: float,
    CHC: float,
    UPD: float
) -> Dict[str, Any]:
    
    return {
        "vehicle_type": vt,
        "lane_type": i_lane,
        "mapped_lane_type": lane,
        "velocity": {
            c.VALUE: nn(velocity, "velocity", "Velocity is a function of Rise & Fall (RF) and Road Roughness (RG) — one or both are returning a negative result. Please check these inputs."),
            c.UNIT: "kmph"
        },
        "VOC_summary": {
            "distance_related": {
                c.FUEL_COST: {
                    c.PETROL: nn(petrol, "petrol"),
                    c.DIESEL: nn(diesel, "diesel"),
                    c.UNIT: "liters per 1000 km",
                    c.iHTC: False
                },
                c.SP: {
                    c.ET: nn(SP_ET / 100, "spare_parts_ET"),
                    c.IT: nn(SP_IT / 100, "spare_parts_IT"),
                    c.UNIT: "Rs/km",
                    c.iHTC: True
                },
                c.ML: {
                    c.VALUE: nn(ML / 100, "maintenance_labour"),
                    c.UNIT: "Rs/km",
                    c.iHTC: False
                },
                c.TYRE_LIFE: {
                    c.VALUE: nn(TL, "tyre_life", "Tyre life is a function of Rise & Fall (RF) and Road Roughness (RG) — one or both are returning a negative result. Please check these inputs."),
                    c.UNIT: "km/tyre",
                    c.iHTC: False
                },
                c.ENGINE_OIL: {
                    c.VALUE: nn(EOL, "engine_oil"),
                    c.UNIT: "liters per 1000 km",
                    c.iHTC: False
                },
                c.OTHER_OIL: {
                    c.VALUE: nn(OL, "other_oil"),
                    c.UNIT: "liters per 10000 km",
                    c.iHTC: False
                },
                c.GREASE: {
                    c.VALUE: nn(G, "grease"),
                    c.UNIT: "kg per 10000 km",
                    c.iHTC: False
                },
            },

            "time_related": {
                c.FIXED_COST: {
                    c.ET: nn(FXC_ET, "fixed_cost_ET"),
                    c.IT: nn(FXC_IT, "fixed_cost_IT"),
                    c.UNIT: "Rs/km",
                    c.iHTC: True
                },
                c.DEPRECIATION_COST: {
                    c.ET: nn(DC_ET, "depreciation_cost_ET"),
                    c.IT: nn(DC_IT, "depreciation_cost_IT"),
                    c.UNIT: "Rs/km",
                    c.iHTC: True
                },
                c.PASSENGER_TIME_COST: {
                    c.VALUE: nn(PT, "passenger_time_cost"),
                    c.UNIT: "Rs/km",
                    c.iHTC: False
                },
                c.CREW_COST: {
                    c.VALUE: nn(crew, "crew_cost"),
                    c.UNIT: "Rs/km",
                    c.iHTC: False
                },
                c.CHC: {
                    c.VALUE: nn(CHC, "commodity_holding_cost"),
                    c.UNIT: "Rs/km",
                    c.iHTC: False
                },
            },

            "utilisation": {
                c.VALUE: nn(UPD, "utilisation"),
                c.iHTC: False
            },
            "note": "All Values mentioned here are without WPI adjustments!"
        }
    }
