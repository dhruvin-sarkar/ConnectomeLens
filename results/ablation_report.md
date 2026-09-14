# Structural redundancy: removing the Giant Fiber from the type graph

This is a structural analysis of the wiring diagram. It shows which alternative synaptic routes exist once a cell type is deleted from the graph; it makes no claim about behavior, and it cannot capture electrical synapses, neuromodulation or timing.

Route: strongest path from LPLC2 to TTMn (edge cost -log of the share of the source type's output synapses). Removed node: the intermediate type on that route with the highest classifier probability, **DNp01** (out-of-fold probability 0.024; intermediates were DNp01).

| route | before | hops before | after | hops after | output-share product before -> after | outcome |
|---|---|---|---|---|---|---|
| LPLC2 -> TTMn | LPLC2 -> DNp01 -> TTMn | 2 | LPLC2 -> DNp103 -> IN07B054 -> IN21A027 -> TTMn | 4 | 9.45e-04 -> 4.92e-06 | rerouted, longer |
| LC4 -> TTMn | LC4 -> DNp01 -> TTMn | 2 | LC4 -> DNp11 -> IN21A026 -> TTMn | 3 | 1.64e-03 -> 1.55e-04 | rerouted, longer |
| LPLC2 -> DLMn c-f | LPLC2 -> DNp01 -> IN18B034 -> DLMn c-f | 3 | LPLC2 -> LPLC4 -> DNp31 -> DLMn c-f | 3 | 1.39e-04 -> 2.83e-05 | rerouted, same length |

Synapse counts along each route:

- LPLC2 -> TTMn, before: LPLC2 -(4862)-> DNp01 -(90)-> TTMn
- LPLC2 -> TTMn, after: LPLC2 -(5065)-> DNp103 -(402)-> IN07B054 -(75)-> IN21A027 -(313)-> TTMn
- LC4 -> TTMn, before: LC4 -(6362)-> DNp01 -(90)-> TTMn
- LC4 -> TTMn, after: LC4 -(3666)-> DNp11 -(112)-> IN21A026 -(507)-> TTMn
- LPLC2 -> DLMn c-f, before: LPLC2 -(4862)-> DNp01 -(75)-> IN18B034 -(1233)-> DLMn c-f
- LPLC2 -> DLMn c-f, after: LPLC2 -(3476)-> LPLC4 -(2022)-> DNp31 -(1128)-> DLMn c-f
