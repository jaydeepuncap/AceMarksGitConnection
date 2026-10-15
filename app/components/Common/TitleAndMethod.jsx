import React, { Fragment } from "react";
import { Section, Select, TextField } from "../../components/ui";
import { useParams } from "react-router-dom";

const options = [
    { label: "Rename", value: "Rename" },
    { label: "Sort", value: "Sort" },
    { label: "Hide", value: "Delete If" },
];

const TitleAndMethod = ({ formData, setFormData, formDataError, setFormDataError, formValidate, type }) => {
    const { id } = useParams();

    const onChange = (name, value) => {
        setFormData({ ...formData, [name]: value })
        if (formDataError[name]) {
            setFormDataError({ ...formDataError, [name]: value.trim() ? "" : formDataError[name] })
        }
    }
    
    const onBlur = (event) => {
        const { name, value } = event.target;
        setFormDataError({ ...formDataError, [name]: formValidate(name, value) })
    }

    return (
        <Fragment>
            {
                id === "new" ? <Section padding={'base'} heading={type === "shipping" ? "Rule Type" : "Rule Type"}>
                    <Select
                        options={options} value={formData.shopifyScriptMethod}
                        onChange={(event) => onChange("shopifyScriptMethod", event?.target?.value)}
                        details={type === "shipping" ? "Choose how you want to customize shipping methods at checkout." : "Choose how you want to customize payment methods at checkout."}
                    />
                </Section> : ""
            }
            <Section padding={'base'} heading="Rule Name">
                <TextField placeholder={type === "shipping" ? "e.g. Hide standard shipping for high-value orders" : "e.g. Hide PayPal for wholesale customers"} name={"title"} onBlur={onBlur}
                    error={formDataError.title} requiredIndicator
                    onInput={(event) => onChange("title", event?.target?.value)}
                    value={formData?.title} details={"Only visible to you — not shown to customers."} />
            </Section>
        </Fragment>
    );
};

export default React.memo(TitleAndMethod);